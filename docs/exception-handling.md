# Exception Handling & Error Response Reference

This document defines the error and exception handling architecture for the MoveMe API. It documents all exception paths, status codes, response shapes, and the corresponding automated tests or requests proving each path.

---

## 1. Architectural Principles

1. **Consistent Error Envelope (`{ error: string }`)**:
   Every non-2xx response from the MoveMe API strictly returns a single JSON object with the shape:
   ```json
   {
     "error": "Descriptive error message"
   }
   ```
   No extra wrappers, custom status properties, or nested metadata objects are returned.

2. **Express 5 Forwarding & Centralized Error Middleware**:
   Express 5 natively forwards rejected promises from asynchronous route handlers directly to downstream error-handling middleware. Route handlers rethrow unhandled exceptions (rolling back any active transactions prior to rethrow). At the end of [src/app.ts](file:///c:/Users/HP/Desktop/MOVE%20ME/src/app.ts), the final error middleware catches all unhandled exceptions:
   - Logs the full error details server-side via `console.error(err)`.
   - Sends HTTP status `500` with body `{ "error": "Internal server error" }`.
   - **Zero Leakage**: Stack traces and SQL queries are never exposed in HTTP response bodies in any environment (test, development, or production).

3. **Malformed JSON Request Body Handling**:
   Malformed JSON payloads sent with `Content-Type: application/json` are caught by the final error middleware (handling `SyntaxError` from `express.json()`) and return HTTP status `400`:
   ```json
   {
     "error": "Malformed JSON body"
   }
   ```
   This replaces default HTML error pages previously emitted by raw Express body-parsers.

4. **Catch-All 404 Handler**:
   Any incoming request that does not match a declared endpoint path or HTTP method triggers the JSON 404 handler registered immediately before error middleware in [src/app.ts](file:///c:/Users/HP/Desktop/MOVE%20ME/src/app.ts):
   ```json
   {
     "error": "Not found"
   }
   ```

5. **Data Exposure Scoping & Payment Privacy (`GET /reservations/:id`)**:
   - **Passenger**: Sees their own reservation. For payment rows, only public-safe fields are exposed: `{ id, status, amount, refunded_at }`.
   - **Driver**: Sees reservation and trip status on their departure, but **no** payment records (`payments` property is omitted).
   - **Never Leaked**: `idempotency_key` is strictly stripped and never returned to either role or caller under any circumstances.

---

## 2. API Exception Paths Inventory

The following table documents every exception path in the API, compiled directly from route handlers, validation schemas, and database constraints.

| Endpoint | Trigger / Condition | HTTP Status | Response Message / Body | Proving Test (File & Test Name) or Request | Status |
| :--- | :--- | :---: | :--- | :--- | :---: |
| **All Endpoints** | Unknown route path or unsupported method | `404` | `{ error: "Not found" }` | `src/routes/exception-handling.routes.test.ts`<br>`"returns 404 { error: 'Not found' } for unknown GET route"` | Tested |
| **All Endpoints (JSON)** | Malformed JSON in request body | `400` | `{ error: "Malformed JSON body" }` | `src/routes/exception-handling.routes.test.ts`<br>`"returns 400 { error: 'Malformed JSON body' } when malformed JSON is sent to POST endpoint"` | Tested |
| **All Endpoints** | Unhandled exception or database error thrown in route handler | `500` | `{ error: "Internal server error" }` | `src/routes/exception-handling.routes.test.ts`<br>`"returns 500 { error: 'Internal server error' } with no stack trace or SQL text when a handler throws"` | Tested |
| **Protected (`requireAuth`)** | Missing or non-Bearer `Authorization` header | `401` | `{ error: "Authentication token missing or invalid" }` | `src/middleware/auth.middleware.test.ts`<br>`"returns 401 if Authorization header is missing"` | Tested |
| **Protected (`requireAuth`)** | Malformed Authorization header format | `401` | `{ error: "Authentication token missing or invalid" }` | `src/middleware/auth.middleware.test.ts`<br>`"returns 401 if Authorization header is malformed"` | Tested |
| **Protected (`requireAuth`)** | Invalid, tampered, or expired JWT token | `401` | `{ error: "Invalid or expired token" }` | `src/middleware/auth.middleware.test.ts`<br>`"returns 401 if token is invalid"` | Tested |
| **Protected (`requireAuth`)** | JWT token payload missing `sub` or `role` | `401` | `{ error: "Invalid token payload" }` | *None (untested edge case)* | **Untested** |
| **Protected (`requireAuth`)** | `JWT_SECRET` not configured in server environment | `500` | `{ error: "JWT_SECRET is not configured on server" }` | *None (untested config failure)* | **Untested** |
| **Role-Gated (`requireRole`)** | Authenticated user role does not match required role | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/middleware/auth.middleware.test.ts`<br>`"returns 403 if user role is not in the allowed list"` | Tested |
| `POST /auth/register/passenger` | Body validation error (e.g. invalid email or password < 6 chars) | `400` | `{ error: "Validation failed" }` | `src/routes/auth.routes.test.ts`<br>`"returns 400 for invalid email format"` | Tested |
| `POST /auth/register/passenger` | Duplicate email address already registered | `409` | `{ error: "Email is already registered" }` | `src/routes/auth.routes.test.ts`<br>`"returns 409 when registering with an existing email"` | Tested |
| `POST /auth/register/driver` | Body validation error (missing password, short password, invalid email) | `400` | `{ error: "Validation failed" }` | `src/routes/auth.routes.test.ts`<br>`"returns 400 for short password (< 6 chars)"` | Tested |
| `POST /auth/register/driver` | Duplicate email address already registered | `409` | `{ error: "Email is already registered" }` | `src/routes/auth.routes.test.ts`<br>`"returns 409 when driver email already exists"` | Tested |
| `POST /auth/login` | Body validation error (missing email or password) | `400` | `{ error: "Validation failed" }` | `src/routes/auth.routes.test.ts`<br>`"returns 400 for missing password"` | Tested |
| `POST /auth/login` | Email does not exist in `users` | `401` | `{ error: "Invalid email or password" }` | `src/routes/auth.routes.test.ts`<br>`"returns 401 for non-existent email"` | Tested |
| `POST /auth/login` | Password does not match Argon2 password hash | `401` | `{ error: "Invalid email or password" }` | `src/routes/auth.routes.test.ts`<br>`"returns 401 for incorrect password"` | Tested |
| `POST /auth/login` | Server missing `JWT_SECRET` | `500` | `{ error: "JWT_SECRET is not configured on server" }` | *None (untested config failure)* | **Untested** |
| `GET /admin/drivers` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/driver_and_admin.test.ts`<br>`"returns 401 if unauthenticated"` | Tested |
| `GET /admin/drivers` | Caller is not ADMIN (e.g. DRIVER) | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/driver_and_admin.test.ts`<br>`"returns 403 if caller is DRIVER, not ADMIN"` | Tested |
| `PATCH /admin/drivers/:id/enable` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/driver_and_admin.test.ts`<br>`"PATCH /admin/drivers/:id/enable returns 401 if unauthenticated"` | Tested |
| `PATCH /admin/drivers/:id/enable` | Caller is not ADMIN | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/driver_and_admin.test.ts`<br>`"PATCH /admin/drivers/:id/enable returns 403 if caller is DRIVER"` | Tested |
| `PATCH /admin/drivers/:id/enable` | Request body missing or non-boolean `enabled` | `400` | `{ error: "Validation failed" }` | `src/routes/driver_and_admin.test.ts`<br>`"PATCH /admin/drivers/:id/enable returns 400 if enabled is not boolean"` | Tested |
| `PATCH /admin/drivers/:id/enable` | Target user ID not found or target user is not a DRIVER | `404` | `{ error: "Driver not found" }` | `src/routes/driver_and_admin.test.ts`<br>`"returns 404 if driver ID does not exist"` | Tested |
| `POST /drivers/me/vehicles` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/driver_and_admin.test.ts`<br>`"POST /drivers/me/vehicles returns 401 if unauthenticated"` | Tested |
| `POST /drivers/me/vehicles` | Caller is not DRIVER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/driver_and_admin.test.ts`<br>`"POST /drivers/me/vehicles returns 403 if caller is PASSENGER"` | Tested |
| `POST /drivers/me/vehicles` | Payload validation failure (e.g. missing seatCapacity or seatCapacity < 1) | `400` | `{ error: "Validation failed" }` | `src/routes/driver_and_admin.test.ts`<br>`"returns 400 for invalid vehicle payload"` | Tested |
| `POST /drivers/me/vehicles` | Vehicle `registrationIdentifier` already registered | `409` | `{ error: "Registration identifier already registered" }` | `src/routes/driver_and_admin.test.ts`<br>`"returns 409 if vehicle registration identifier already exists"` | Tested |
| `GET /drivers/me/vehicles` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/driver_and_admin.test.ts`<br>`"GET /drivers/me/vehicles returns 401 if unauthenticated"` | Tested |
| `GET /drivers/me/vehicles` | Caller is not DRIVER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/driver_and_admin.test.ts`<br>`"GET /drivers/me/vehicles returns 403 if caller is PASSENGER"` | Tested |
| `GET /drivers/me/departures` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/read-side.routes.test.ts`<br>`"returns 401 if unauthenticated"` | Tested |
| `GET /drivers/me/departures` | Caller is not DRIVER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/read-side.routes.test.ts`<br>`"returns 403 if caller is not a DRIVER"` | Tested |
| `GET /routes` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/route.routes.test.ts`<br>`"returns 401 if unauthenticated"` | Tested |
| `GET /departures/search` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/departure.routes.test.ts`<br>`"returns 401 if unauthenticated"` | Tested |
| `GET /departures/search` | Caller is not PASSENGER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/departure.routes.test.ts`<br>`"returns 403 if caller is not PASSENGER"` | Tested |
| `GET /departures/search` | Invalid query string (e.g. non-UUID `routeId`, missing `mode`) | `400` | `{ error: "Validation failed" }` | `src/routes/departure.routes.test.ts`<br>`"returns 400 if routeId is not a valid UUID"` | Tested |
| `POST /departures` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/departure.routes.test.ts`<br>`"returns 401 if unauthenticated"` | Tested |
| `POST /departures` | Caller is not DRIVER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/departure.routes.test.ts`<br>`"returns 403 if passenger tries to publish departure"` | Tested |
| `POST /departures` | Body validation failure (missing required fields or invalid mode) | `400` | `{ error: "Validation failed" }` | `src/routes/departure.routes.test.ts`<br>`"returns 400 for missing required fields"` | Tested |
| `POST /departures` | Driver account has `driver_enabled = false` | `403` | `{ error: "Driver is not enabled to publish departures" }` | `src/routes/departure.routes.test.ts`<br>`"returns 403 if driver is not enabled"` | Tested |
| `POST /departures` | Target vehicle does not belong to calling driver | `403` | `{ error: "Vehicle does not belong to driver" }` | `src/routes/departure.routes.test.ts`<br>`"returns 403 if vehicle does not belong to driver"` | Tested |
| `POST /departures` | Route ID not found or inactive | `404` | `{ error: "Route not found" }` | `src/routes/departure.routes.test.ts`<br>`"returns 404 if route is not found or inactive"` | Tested |
| `POST /departures` | Driver or vehicle has an overlapping departure (Postgres exclusion violation `23P01`) | `409` | `{ error: "Overlapping departure detected for this driver or vehicle" }` | `src/routes/departure.routes.test.ts`<br>`"returns 409 for overlapping departure by same driver"` | Tested |
| `POST /departures/:id/reservations` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/booking.routes.test.ts`<br>`"returns 401 if unauthenticated"` | Tested |
| `POST /departures/:id/reservations` | Caller is not PASSENGER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/booking.routes.test.ts`<br>`"returns 403 if driver attempts booking"` | Tested |
| `POST /departures/:id/reservations` | Malformed departure UUID parameter | `400` | `{ error: "Invalid departure ID format" }` | `src/routes/departure.routes.test.ts`<br>`"returns 400 for invalid departure ID format"` | Tested |
| `POST /departures/:id/reservations` | Departure row not found | `404` | `{ error: "Departure not found" }` | `src/routes/departure.routes.test.ts`<br>`"returns 404 if departure does not exist"` | Tested |
| `POST /departures/:id/reservations` | Departure status is not `SCHEDULED` | `409` | `{ error: "Departure is not eligible for reservations" }` | `src/routes/trip.routes.test.ts`<br>`"asserts the booking returns 409"` | Tested |
| `POST /departures/:id/reservations` | Active reservations count >= vehicle capacity | `409` | `{ error: "No available capacity on this departure" }` | `src/routes/booking.routes.test.ts`<br>`"returns 409 No available capacity when pooled departure reaches capacity"` | Tested |
| `POST /departures/:id/reservations` | Passenger already has an active reservation for this departure (unique index `23505`) | `409` | `{ error: "Passenger already has an active reservation for this departure" }` | `src/routes/departure.routes.test.ts`<br>`"returns 409 if passenger already has an active reservation"` | Tested |
| `POST /departures/:id/arrive` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/trip.routes.test.ts`<br>`"returns 401 if unauthenticated"` | Tested |
| `POST /departures/:id/arrive` | Caller is not DRIVER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/trip.routes.test.ts`<br>`"returns 403 if caller is PASSENGER"` | Tested |
| `POST /departures/:id/arrive` | Malformed departure UUID | `400` | `{ error: "Invalid departure ID format" }` | `src/routes/trip.routes.test.ts`<br>`"returns 400 for malformed departure id"` | Tested |
| `POST /departures/:id/arrive` | Departure row not found | `404` | `{ error: "Departure not found" }` | `src/routes/trip.routes.test.ts`<br>`"returns 404 if departure does not exist"` | Tested |
| `POST /departures/:id/arrive` | Calling driver does not own the departure | `403` | `{ error: "Forbidden: you do not own this departure" }` | `src/routes/trip.routes.test.ts`<br>`"returns 403 if driver does not own the departure"` | Tested |
| `POST /departures/:id/arrive` | Departure status is not `SCHEDULED` | `409` | `{ error: "Cannot arrive: departure status is <STATUS>, expected SCHEDULED" }` | `src/routes/trip.routes.test.ts`<br>`"returns 409 if departure is already ARRIVED or IN_PROGRESS"` | Tested |
| `POST /departures/:id/arrive` | Driver already has a trip in progress (unique index `23505`) | `409` | `{ error: "You already have a trip in progress" }` | *None (untested concurrent unique index race)* | **Untested** |
| `POST /departures/:id/depart` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/trip.routes.test.ts`<br>`"returns 401 if unauthenticated"` | Tested |
| `POST /departures/:id/depart` | Caller is not DRIVER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/trip.routes.test.ts`<br>`"returns 403 if caller is PASSENGER"` | Tested |
| `POST /departures/:id/depart` | Malformed departure UUID | `400` | `{ error: "Invalid departure ID format" }` | `src/routes/trip.routes.test.ts`<br>`"returns 400 for malformed departure id"` | Tested |
| `POST /departures/:id/depart` | Departure row not found | `404` | `{ error: "Departure not found" }` | `src/routes/trip.routes.test.ts`<br>`"returns 404 if departure does not exist"` | Tested |
| `POST /departures/:id/depart` | Calling driver does not own the departure | `403` | `{ error: "Forbidden: you do not own this departure" }` | `src/routes/trip.routes.test.ts`<br>`"returns 403 if driver does not own the departure"` | Tested |
| `POST /departures/:id/depart` | Departure status is not `ARRIVED` | `409` | `{ error: "Cannot depart: departure status is <STATUS>, expected ARRIVED" }` | `src/routes/trip.routes.test.ts`<br>`"returns 409 if departure status is not ARRIVED"` | Tested |
| `POST /departures/:id/depart` | Driver already has another trip in progress (unique index `23505`) | `409` | `{ error: "You already have a trip in progress" }` | *None (untested race)* | **Untested** |
| `POST /departures/:id/complete` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/trip.routes.test.ts`<br>`"returns 401 if unauthenticated"` | Tested |
| `POST /departures/:id/complete` | Caller is not DRIVER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/trip.routes.test.ts`<br>`"returns 403 if caller is PASSENGER"` | Tested |
| `POST /departures/:id/complete` | Malformed departure UUID | `400` | `{ error: "Invalid departure ID format" }` | `src/routes/trip.routes.test.ts`<br>`"returns 400 for malformed departure id"` | Tested |
| `POST /departures/:id/complete` | Departure row not found | `404` | `{ error: "Departure not found" }` | `src/routes/trip.routes.test.ts`<br>`"returns 404 if departure does not exist"` | Tested |
| `POST /departures/:id/complete` | Calling driver does not own the departure | `403` | `{ error: "Forbidden: you do not own this departure" }` | `src/routes/trip.routes.test.ts`<br>`"returns 403 if driver does not own the departure"` | Tested |
| `POST /departures/:id/complete` | Departure status is not `IN_PROGRESS` | `409` | `{ error: "Cannot complete: departure status is <STATUS>, expected IN_PROGRESS" }` | `src/routes/trip.routes.test.ts`<br>`"returns 409 if departure status is not IN_PROGRESS"` | Tested |
| `POST /departures/:id/cancel` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/driver-cancellation.routes.test.ts`<br>`"returns 401 if unauthenticated"` | Tested |
| `POST /departures/:id/cancel` | Caller is not DRIVER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/driver-cancellation.routes.test.ts`<br>`"returns 403 if caller is PASSENGER"` | Tested |
| `POST /departures/:id/cancel` | Malformed departure UUID | `400` | `{ error: "Invalid departure ID format" }` | `src/routes/driver-cancellation.routes.test.ts`<br>`"returns 400 for malformed departure id"` | Tested |
| `POST /departures/:id/cancel` | Departure row not found | `404` | `{ error: "Departure not found" }` | `src/routes/driver-cancellation.routes.test.ts`<br>`"returns 404 if departure not found"` | Tested |
| `POST /departures/:id/cancel` | Calling driver does not own the departure | `403` | `{ error: "Forbidden: you do not own this departure" }` | `src/routes/driver-cancellation.routes.test.ts`<br>`"returns 403 if driver does not own the departure"` | Tested |
| `POST /departures/:id/cancel` | Departure status is neither `SCHEDULED` nor `ARRIVED` (e.g. `IN_PROGRESS`, `COMPLETED`, `CANCELLED`) | `409` | `{ error: "Cannot cancel departure: status is <STATUS>, expected SCHEDULED or ARRIVED" }` | `src/routes/driver-cancellation.routes.test.ts`<br>`"returns 409 if departure is IN_PROGRESS"` | Tested |
| `GET /reservations/:id` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/reservation.routes.test.ts`<br>`"returns 401 if Authorization header is missing"` | Tested |
| `GET /reservations/:id` | Malformed reservation UUID parameter | `400` | `{ error: "Invalid reservation ID format" }` | `src/routes/reservation.routes.test.ts`<br>`"returns 400 for malformed UUID format"` | Tested |
| `GET /reservations/:id` | Reservation row not found | `404` | `{ error: "Reservation not found" }` | `src/routes/reservation.routes.test.ts`<br>`"returns 404 for non-existent reservation ID"` | Tested |
| `GET /reservations/:id` | Caller is PASSENGER but does not own reservation | `403` | `{ error: "Forbidden: not your reservation" }` | `src/routes/reservation.routes.test.ts`<br>`"returns 403 when Passenger B attempts to access Passenger A's reservation"` | Tested |
| `GET /reservations/:id` | Caller is DRIVER but does not own departure | `403` | `{ error: "Forbidden: not your departure" }` | `src/routes/reservation.routes.test.ts`<br>`"returns 403 when Driver B attempts to access a reservation on Driver A's departure"` | Tested |
| `GET /reservations/:id` | Caller role is not PASSENGER or DRIVER (e.g. ADMIN) | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/reservation.routes.test.ts`<br>`"returns 403 when Admin attempts to access a reservation"` | Tested |
| `POST /reservations/:id/payments` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/payment.routes.test.ts`<br>`"returns 401 if unauthenticated"` | Tested |
| `POST /reservations/:id/payments` | Caller is not PASSENGER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/payment.routes.test.ts`<br>`"returns 403 if driver attempts payment creation"` | Tested |
| `POST /reservations/:id/payments` | Malformed reservation UUID | `400` | `{ error: "Invalid reservation ID format" }` | `src/routes/payment.routes.test.ts`<br>`"returns 400 for invalid reservation ID format"` | Tested |
| `POST /reservations/:id/payments` | Reservation row not found | `404` | `{ error: "Reservation not found" }` | `src/routes/payment.routes.test.ts`<br>`"returns 404 if reservation does not exist"` | Tested |
| `POST /reservations/:id/payments` | Caller does not own the reservation | `403` | `{ error: "Forbidden: not your reservation" }` | `src/routes/payment.routes.test.ts`<br>`"returns 403 if passenger does not own the reservation"` | Tested |
| `POST /reservations/:id/payments` | Reservation status != `PENDING_PAYMENT` or hold elapsed (`hold_expires_at <= now()`) | `409` | `{ error: "Reservation is no longer pending payment or hold has expired" }` | `src/routes/payment.routes.test.ts`<br>`"returns 409 if reservation hold has expired"` | Tested |
| `POST /reservations/:id/payments` | Payment with client-provided idempotency key already exists (constraint `23505`) | `409` | `{ error: "Payment with this idempotency key already exists" }` | *None (untested client idempotency collision)* | **Untested** |
| `POST /reservations/:id/cancel` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/cancellation.routes.test.ts`<br>`"returns 401 if unauthenticated"` | Tested |
| `POST /reservations/:id/cancel` | Caller is not PASSENGER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/cancellation.routes.test.ts`<br>`"returns 403 if caller is DRIVER"` | Tested |
| `POST /reservations/:id/cancel` | Malformed reservation UUID | `400` | `{ error: "Invalid reservation ID format" }` | `src/routes/cancellation.routes.test.ts`<br>`"returns 400 for malformed reservation id"` | Tested |
| `POST /reservations/:id/cancel` | Reservation row not found | `404` | `{ error: "Reservation not found" }` | `src/routes/cancellation.routes.test.ts`<br>`"returns 404 if reservation does not exist"` | Tested |
| `POST /reservations/:id/cancel` | Caller is not the reservation's passenger owner | `403` | `{ error: "Forbidden: not your reservation" }` | `src/routes/cancellation.routes.test.ts`<br>`"returns 403 if passenger attempts to cancel another passenger's reservation"` | Tested |
| `POST /reservations/:id/cancel` | Associated departure row not found under lock | `404` | `{ error: "Associated departure not found" }` | *None (untested orphaned reservation row)* | **Untested** |
| `POST /reservations/:id/cancel` | Reservation status is not `CONFIRMED` (e.g. `PENDING_PAYMENT` or already `CANCELLED`) | `409` | `{ error: "Only a confirmed reservation can be cancelled" }` | `src/routes/cancellation.routes.test.ts`<br>`"returns 409 if reservation is in PENDING_PAYMENT"` | Tested |
| `POST /reservations/:id/cancel` | Departure time passed (`departure_time <= clock_timestamp()`) OR departure status not `SCHEDULED`/`ARRIVED` | `409` | `{ error: "Cannot cancel reservation: departure time has passed or trip is already in progress" }` | `src/routes/cancellation.routes.test.ts`<br>`"returns 409 if departure is already IN_PROGRESS"` | Tested |
| `POST /payments/:id/callback` | Malformed payment UUID | `400` | `{ error: "Invalid payment ID format" }` | `src/routes/payment.routes.test.ts`<br>`"returns 400 for invalid payment ID format"` | Tested |
| `POST /payments/:id/callback` | Body validation failure: outcome is not `SUCCESS` or `FAILURE` | `400` | `{ error: "Invalid callback payload: outcome must be 'SUCCESS' or 'FAILURE'" }` | `src/routes/payment.routes.test.ts`<br>`"returns 400 if outcome is missing or invalid"` | Tested |
| `POST /payments/:id/callback` | Payment row not found | `404` | `{ error: "Payment not found" }` | `src/routes/payment.routes.test.ts`<br>`"returns 404 if payment does not exist"` | Tested |
| `POST /payments/:id/callback` | Associated reservation row not found | `404` | `{ error: "Associated reservation not found" }` | *None (untested orphaned payment)* | **Untested** |
| `POST /payments/:id/callback` | Associated departure row not found | `404` | `{ error: "Associated departure not found" }` | *None (untested orphaned reservation)* | **Untested** |
| `GET /payments/:id` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/payment-read.routes.test.ts`<br>`"no token 401"` | Tested |
| `GET /payments/:id` | Malformed payment UUID | `400` | `{ error: "Invalid payment ID format" }` | `src/routes/payment-read.routes.test.ts`<br>`"malformed id 400"` | Tested |
| `GET /payments/:id` | Payment row not found | `404` | `{ error: "Payment not found" }` | `src/routes/payment-read.routes.test.ts`<br>`"unknown id 404"` | Tested |
| `GET /payments/:id` | Caller is not the reservation's passenger owner (another passenger, driver, admin) | `403` | `{ error: "Forbidden: not your payment" }` | `src/routes/payment-read.routes.test.ts`<br>`"another passenger 403"`<br>`"a driver (including the departure's own driver) 403"`<br>`"admin 403"` | Tested |
| `GET /passengers/me/reservations` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/reservation.routes.test.ts`<br>`"returns 401 if unauthenticated"` | Tested |
| `GET /passengers/me/reservations` | Caller is not PASSENGER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/reservation.routes.test.ts`<br>`"returns 403 if caller is DRIVER, not PASSENGER"` | Tested |
| `GET /passengers/me/notifications` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/read-side.routes.test.ts`<br>`"returns 401 if unauthenticated"` | Tested |
| `GET /passengers/me/notifications` | Caller is not PASSENGER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/read-side.routes.test.ts`<br>`"returns 403 if caller is not a PASSENGER"` | Tested |
| `PATCH /notifications/:id/read` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/read-side.routes.test.ts`<br>`"returns 401 if unauthenticated"` | Tested |
| `PATCH /notifications/:id/read` | Caller is not PASSENGER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/read-side.routes.test.ts`<br>`"returns 403 if caller is not a PASSENGER"` | Tested |
| `PATCH /notifications/:id/read` | Malformed notification UUID | `400` | `{ error: "Invalid notification ID format" }` | `src/routes/read-side.routes.test.ts`<br>`"returns 400 for malformed notification ID"` | Tested |
| `PATCH /notifications/:id/read` | Notification row not found | `404` | `{ error: "Notification not found" }` | `src/routes/read-side.routes.test.ts`<br>`"returns 404 if notification not found"` | Tested |
| `PATCH /notifications/:id/read` | Notification belongs to another user | `403` | `{ error: "Forbidden: not your notification" }` | `src/routes/read-side.routes.test.ts`<br>`"returns 403 if notification belongs to another passenger"` | Tested |

---

## 3. Flagged Untested Paths Summary

The audit identified the following specific exception paths that currently lack explicit automated test cases in the test suite:

1. **`JWT_SECRET` missing in server environment (`500`)**: Handled in `auth.middleware.ts` and `auth.routes.ts` (`JWT_SECRET is not configured on server`).
2. **Missing `sub` or `role` claims in decoded JWT (`401`)**: Handled in `auth.middleware.ts` (`Invalid token payload`).
3. **Non-Zod error during body/query parsing (`400`)**: Handled in `validate.middleware.ts` (`Invalid request payload` / `Invalid query parameters`).
4. **Duplicate trip in progress during arrival/departure race (`409`)**: Handled in `POST /departures/:id/arrive` and `POST /departures/:id/depart` (`You already have a trip in progress`).
5. **Client-provided idempotency key collision (`409`)**: Handled in `POST /reservations/:id/payments` (`Payment with this idempotency key already exists`).
6. **Orphaned relations (`404`)**:
   - `Associated departure not found` in `POST /reservations/:id/cancel`
   - `Associated reservation not found` in `POST /payments/:id/callback`
   - `Associated departure not found` in `POST /payments/:id/callback`
