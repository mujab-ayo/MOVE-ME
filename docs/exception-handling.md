# Exception Handling & Error Response Reference

This document defines the error and exception handling architecture for the MoveMe API. It documents all exception paths, status codes, response shapes, and the corresponding automated tests proving each path.

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
   Express 5 natively forwards rejected promises from asynchronous route handlers directly to downstream error-handling middleware. Route handlers rethrow unhandled exceptions (rolling back any active transactions prior to rethrow). At the end of `src/app.ts`, the final error middleware catches all unhandled exceptions:
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
   Any incoming request that does not match a declared endpoint path or HTTP method triggers the JSON 404 handler registered immediately before error middleware in `src/app.ts`:
   ```json
   {
     "error": "Not found"
   }
   ```

5. **Data Exposure Scoping & Payment Privacy (`GET /reservations/:id` and `GET /payments/:id`)**:
   - **Passenger**: Sees their own reservation. For payment rows, only public-safe fields are exposed: `{ id, status, amount, refunded_at }`. On `GET /payments/:id`, only the reservation owner can read the payment, receiving `{ id, reservation_id, amount, status, completed_at, refunded_at }`.
   - **Driver**: Sees reservation and trip status on their departure, but **no** payment records (`payments` property is omitted). Drivers receive `403` on `GET /payments/:id`.
   - **Never Leaked**: `idempotency_key` is strictly stripped and never returned to either role or caller under any circumstances.

---

## 2. API Exception Paths Inventory

The following table documents every exception path in the API, compiled directly from route handlers, validation schemas, and database constraints. Every row marked `Tested` cites its proving test verbatim from the test suite.

| Endpoint | Trigger / Condition | HTTP Status | Response Message / Body | Proving Test (File & Test Name) | Status |
| :--- | :--- | :---: | :--- | :--- | :---: |
| **All Endpoints** | Unknown route path or unsupported method | `404` | `{ error: "Not found" }` | `src/routes/exception-handling.routes.test.ts`<br>`"returns 404 { error: 'Not found' } for unknown GET route"` | Tested |
| **All Endpoints (JSON)** | Malformed JSON in request body | `400` | `{ error: "Malformed JSON body" }` | `src/routes/exception-handling.routes.test.ts`<br>`"returns 400 { error: 'Malformed JSON body' } when malformed JSON is sent to POST endpoint"` | Tested |
| **All Endpoints** | Unhandled exception or database error thrown in route handler | `500` | `{ error: "Internal server error" }` | `src/routes/exception-handling.routes.test.ts`<br>`"returns 500 { error: 'Internal server error' } with no stack trace or SQL text when a handler throws"` | Tested |
| **Protected (`requireAuth`)** | Missing or non-Bearer `Authorization` header | `401` | `{ error: "Authentication token missing or invalid" }` | `src/middleware/auth.middleware.test.ts`<br>`"returns 401 if Authorization header is missing"` | Tested |
| **Protected (`requireAuth`)** | Malformed Authorization header format | `401` | `{ error: "Authentication token missing or invalid" }` | `src/middleware/auth.middleware.test.ts`<br>`"returns 401 if Authorization header is malformed"` | Tested |
| **Protected (`requireAuth`)** | Invalid, tampered, or expired JWT token | `401` | `{ error: "Invalid or expired token" }` | `src/middleware/auth.middleware.test.ts`<br>`"returns 401 if token is invalid"` | Tested |
| **Protected (`requireAuth`)** | JWT token payload missing `sub` or `role` | `401` | `{ error: "Invalid token payload" }` | `src/middleware/auth.middleware.test.ts`<br>`"returns 401 if token payload is missing sub or role"` | Tested |
| **Protected (`requireAuth`)** | `JWT_SECRET` not configured in server environment | `500` | `{ error: "JWT_SECRET is not configured on server" }` | *None (untested config failure)* | Untested |
| **Role-Gated (`requireRole`)** | Authenticated user role does not match required role | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/middleware/auth.middleware.test.ts`<br>`"returns 403 if user role is not in the allowed list"` | Tested |
| `POST /auth/register/passenger` | Body validation error (e.g. invalid email or password < 6 chars) | `400` | `{ error: "Validation failed" }` | `src/routes/auth.routes.test.ts`<br>`"returns 400 on invalid input"` | Tested |
| `POST /auth/register/passenger` | Duplicate email address already registered | `409` | `{ error: "Email is already registered" }` | `src/routes/auth.routes.test.ts`<br>`"returns 409 if email is already taken"` | Tested |
| `POST /auth/register/driver` | Body validation error (missing password, short password, invalid email) | `400` | `{ error: "Validation failed" }` | `src/routes/auth.routes.test.ts`<br>`"returns 400 on invalid input for driver registration"` | Tested |
| `POST /auth/register/driver` | Duplicate email address already registered | `409` | `{ error: "Email is already registered" }` | `src/routes/auth.routes.test.ts`<br>`"returns 409 if driver email is already taken"` | Tested |
| `POST /auth/login` | Body validation error (missing email or password) | `400` | `{ error: "Validation failed" }` | `src/routes/auth.routes.test.ts`<br>`"returns 400 on login with missing email"`<br>`"returns 400 on login with missing password"` | Tested |
| `POST /auth/login` | Email does not exist in `users` | `401` | `{ error: "Invalid email or password" }` | `src/routes/auth.routes.test.ts`<br>`"returns 401 on non-existent email"` | Tested |
| `POST /auth/login` | Password does not match Argon2 password hash | `401` | `{ error: "Invalid email or password" }` | `src/routes/auth.routes.test.ts`<br>`"returns 401 on incorrect password"` | Tested |
| `POST /auth/login` | Server missing `JWT_SECRET` | `500` | `{ error: "JWT_SECRET is not configured on server" }` | `src/routes/auth.routes.test.ts`<br>`"returns 500 on login if JWT_SECRET is not configured on server"` | Tested |
| `GET /admin/drivers` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/access-control.routes.test.ts`<br>`"GET /admin/drivers returns 401 without token"` | Tested |
| `GET /admin/drivers` | Caller is not ADMIN (e.g. DRIVER) | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/driver_and_admin.test.ts`<br>`"rejects non-admin roles with 403"` | Tested |
| `PATCH /admin/drivers/:id/enable` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/access-control.routes.test.ts`<br>`"PATCH /admin/drivers/:id/enable returns 401 without token"` | Tested |
| `PATCH /admin/drivers/:id/enable` | Caller is not ADMIN | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/access-control.routes.test.ts`<br>`"PATCH /admin/drivers/:id/enable returns 403 for DRIVER"`<br>`"PATCH /admin/drivers/:id/enable returns 403 for PASSENGER"` | Tested |
| `PATCH /admin/drivers/:id/enable` | Request body missing or non-boolean `enabled` | `400` | `{ error: "Validation failed" }` | `src/routes/driver_and_admin.test.ts`<br>`"returns 400 if enabled is not boolean on driver enable"` | Tested |
| `PATCH /admin/drivers/:id/enable` | Target user ID not found or target user is not a DRIVER | `404` | `{ error: "Driver not found" }` | `src/routes/driver_and_admin.test.ts`<br>`"returns 404 if user is not a driver"` | Tested |
| `POST /drivers/me/vehicles` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/driver_and_admin.test.ts`<br>`"rejects unauthenticated requests with 401"` | Tested |
| `POST /drivers/me/vehicles` | Caller is not DRIVER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/driver_and_admin.test.ts`<br>`"rejects non-driver roles with 403"` | Tested |
| `POST /drivers/me/vehicles` | Payload validation failure (e.g. missing seatCapacity or seatCapacity < 1) | `400` | `{ error: "Validation failed" }` | `src/routes/driver_and_admin.test.ts`<br>`"rejects vehicle creation with seatCapacity 0 with 400"` | Tested |
| `POST /drivers/me/vehicles` | Vehicle `registrationIdentifier` already registered | `409` | `{ error: "Registration identifier already registered" }` | `src/routes/driver_and_admin.test.ts`<br>`"returns 409 when registrationIdentifier is already in use"` | Tested |
| `GET /drivers/me/vehicles` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/access-control.routes.test.ts`<br>`"GET /drivers/me/vehicles returns 401 without token"` | Tested |
| `GET /drivers/me/vehicles` | Caller is not DRIVER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/access-control.routes.test.ts`<br>`"GET /drivers/me/vehicles returns 403 for PASSENGER"`<br>`"GET /drivers/me/vehicles returns 403 for ADMIN"` | Tested |
| `GET /drivers/me/departures` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/access-control.routes.test.ts`<br>`"GET /drivers/me/departures returns 401 without token"` | Tested |
| `GET /drivers/me/departures` | Caller is not DRIVER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/access-control.routes.test.ts`<br>`"GET /drivers/me/departures returns 403 for PASSENGER"`<br>`"GET /drivers/me/departures returns 403 for ADMIN"` | Tested |
| `GET /routes` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/route.routes.test.ts`<br>`"returns 401 without a token"` | Tested |
| `GET /departures/search` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/departure.routes.test.ts`<br>`"rejects unauthenticated requests with 401"` | Tested |
| `GET /departures/search` | Caller is not PASSENGER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/departure.routes.test.ts`<br>`"rejects non-passenger roles with 403"` | Tested |
| `GET /departures/search` | Invalid query string (e.g. non-UUID `routeId`, missing `mode`) | `400` | `{ error: "Validation failed" }` | `src/routes/departure.routes.test.ts`<br>`"rejects invalid query parameters with 400"` | Tested |
| `POST /departures` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/departure-publish.routes.test.ts`<br>`"401 no token"` | Tested |
| `POST /departures` | Caller is not DRIVER (e.g. PASSENGER) | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/departure-publish.routes.test.ts`<br>`"403 passenger"` | Tested |
| `POST /departures` | Driver account has `driver_enabled = false` | `403` | `{ error: "Driver is not enabled to publish departures" }` | `src/routes/departure-publish.routes.test.ts`<br>`"403 driver not enabled"` | Tested |
| `POST /departures` | Target vehicle does not belong to calling driver | `403` | `{ error: "Vehicle does not belong to driver" }` | `src/routes/departure-publish.routes.test.ts`<br>`"403 vehicle owned by another driver"` | Tested |
| `POST /departures` | Body validation failure (missing required fields or invalid mode) | `400` | `{ error: "Validation failed" }` | `src/routes/departure-publish.routes.test.ts`<br>`"400 invalid body"` | Tested |
| `POST /departures` | Route ID not found or inactive | `404` | `{ error: "Route not found" }` | `src/routes/departure-publish.routes.test.ts`<br>`"404 unknown route"` | Tested |
| `POST /departures` | Driver or vehicle has an overlapping departure (Postgres exclusion violation `23P01`) | `409` | `{ error: "Overlapping departure detected for this driver or vehicle" }` | `src/routes/departure-publish.routes.test.ts`<br>`"409 overlapping departure for the same driver"`<br>`"409 overlap on the same vehicle"` | Tested |
| `POST /departures/:id/reservations` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/access-control.routes.test.ts`<br>`"POST /departures/:id/reservations returns 401 without token"` | Tested |
| `POST /departures/:id/reservations` | Caller is not PASSENGER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/access-control.routes.test.ts`<br>`"POST /departures/:id/reservations returns 403 for DRIVER"`<br>`"POST /departures/:id/reservations returns 403 for ADMIN"` | Tested |
| `POST /departures/:id/reservations` | Malformed departure UUID parameter | `400` | `{ error: "Invalid departure ID format" }` | `src/routes/booking.routes.test.ts`<br>`"returns 400 for malformed departure id on reservations"` | Tested |
| `POST /departures/:id/reservations` | Departure row not found | `404` | `{ error: "Departure not found" }` | `src/routes/booking.routes.test.ts`<br>`"Test 4a: unknown departure id returns 404"` | Tested |
| `POST /departures/:id/reservations` | Departure status is not `SCHEDULED` or departure time has passed | `409` | `{ error: "Departure is not eligible for reservations" }` | `src/routes/booking.routes.test.ts`<br>`"Test 4b: departure that is not SCHEDULED or is past its departure_time returns 409"` | Tested |
| `POST /departures/:id/reservations` | Active reservations count >= vehicle capacity | `409` | `{ error: "No available capacity on this departure" }` | `src/routes/booking.routes.test.ts`<br>`"Test 1: SOLO departure (capacity 1), 10 different passengers, 10 concurrent requests -> exactly 1 success (201) and 9 conflicts (409), exactly 1 active row"` | Tested |
| `POST /departures/:id/reservations` | Passenger already has an active reservation for this departure (unique index `23505`) | `409` | `{ error: "Passenger already has an active reservation for this departure" }` | `src/routes/booking.routes.test.ts`<br>`"Test 3: One passenger firing 2 concurrent bookings on the same departure (capacity >= 2) -> at most one succeeds, other gets 409 (unique index backstop)"` | Tested |
| `POST /departures/:id/arrive` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/trip.routes.test.ts`<br>`"3. Another driver gets 403; a passenger gets 403; no token 401; unknown id 404; malformed id 400"` | Tested |
| `POST /departures/:id/arrive` | Caller is not DRIVER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/trip.routes.test.ts`<br>`"3. Another driver gets 403; a passenger gets 403; no token 401; unknown id 404; malformed id 400"` | Tested |
| `POST /departures/:id/arrive` | Malformed departure UUID | `400` | `{ error: "Invalid departure ID format" }` | `src/routes/trip.routes.test.ts`<br>`"3. Another driver gets 403; a passenger gets 403; no token 401; unknown id 404; malformed id 400"` | Tested |
| `POST /departures/:id/arrive` | Departure row not found | `404` | `{ error: "Departure not found" }` | `src/routes/trip.routes.test.ts`<br>`"3. Another driver gets 403; a passenger gets 403; no token 401; unknown id 404; malformed id 400"` | Tested |
| `POST /departures/:id/arrive` | Calling driver does not own the departure | `403` | `{ error: "Forbidden: you do not own this departure" }` | `src/routes/trip.routes.test.ts`<br>`"3. Another driver gets 403; a passenger gets 403; no token 401; unknown id 404; malformed id 400"` | Tested |
| `POST /departures/:id/arrive` | Departure status is not `SCHEDULED` | `409` | `{ error: "Cannot arrive: departure status is ARRIVED, expected SCHEDULED" }` | `src/routes/trip.routes.test.ts`<br>`"2. Out-of-order transitions (depart before arrive, complete before depart, arrive twice) return 409"` | Tested |
| `POST /departures/:id/arrive` | Driver already has a trip in progress (unique index `23505`) | `409` | `{ error: "You already have a trip in progress" }` | `src/routes/trip.routes.test.ts`<br>`"4. Delayed trip: driver has departure A (arrived or in progress) and a later, non-overlapping departure B whose scheduled time has already passed (set B's departure_time into the past directly in the database). Arriving at B returns 409 while A is active, and succeeds after A completes."` | Tested |
| `POST /departures/:id/depart` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/access-control.routes.test.ts`<br>`"POST /departures/:id/depart returns 401 without token"` | Tested |
| `POST /departures/:id/depart` | Caller is not DRIVER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/access-control.routes.test.ts`<br>`"POST /departures/:id/depart returns 403 for PASSENGER"`<br>`"POST /departures/:id/depart returns 403 for ADMIN"` | Tested |
| `POST /departures/:id/depart` | Malformed departure UUID | `400` | `{ error: "Invalid departure ID format" }` | `src/routes/trip.routes.test.ts`<br>`"returns 400 for malformed departure id on depart"` | Tested |
| `POST /departures/:id/depart` | Departure row not found | `404` | `{ error: "Departure not found" }` | `src/routes/trip.routes.test.ts`<br>`"returns 404 for unknown departure id on depart"` | Tested |
| `POST /departures/:id/depart` | Calling driver does not own the departure | `403` | `{ error: "Forbidden: you do not own this departure" }` | `src/routes/trip.routes.test.ts`<br>`"3. Another driver gets 403; a passenger gets 403; no token 401; unknown id 404; malformed id 400"` | Tested |
| `POST /departures/:id/depart` | Departure status is not `ARRIVED` | `409` | `{ error: "Cannot depart: departure status is SCHEDULED, expected ARRIVED" }` | `src/routes/trip.routes.test.ts`<br>`"2. Out-of-order transitions (depart before arrive, complete before depart, arrive twice) return 409"` | Tested |
| `POST /departures/:id/depart` | Driver already has another trip in progress (unique index `23505`) - unreachable because the partial unique index covers both ARRIVED and IN_PROGRESS, so transitioning from ARRIVED to IN_PROGRESS updates the existing row and cannot create a duplicate | `409` | `{ error: "You already have a trip in progress" }` | *Unreachable (the one_active_trip_per_driver index covers both ARRIVED and IN_PROGRESS, so moving the driver's only active departure from ARRIVED to IN_PROGRESS updates the existing row and cannot create a duplicate)* | Unreachable |
| `POST /departures/:id/complete` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/access-control.routes.test.ts`<br>`"POST /departures/:id/complete returns 401 without token"` | Tested |
| `POST /departures/:id/complete` | Caller is not DRIVER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/access-control.routes.test.ts`<br>`"POST /departures/:id/complete returns 403 for PASSENGER"`<br>`"POST /departures/:id/complete returns 403 for ADMIN"` | Tested |
| `POST /departures/:id/complete` | Malformed departure UUID | `400` | `{ error: "Invalid departure ID format" }` | `src/routes/trip.routes.test.ts`<br>`"returns 400 for malformed departure id on complete"` | Tested |
| `POST /departures/:id/complete` | Departure row not found | `404` | `{ error: "Departure not found" }` | `src/routes/trip.routes.test.ts`<br>`"returns 404 for unknown departure id on complete"` | Tested |
| `POST /departures/:id/complete` | Calling driver does not own the departure | `403` | `{ error: "Forbidden: you do not own this departure" }` | `src/routes/trip.routes.test.ts`<br>`"3. Another driver gets 403; a passenger gets 403; no token 401; unknown id 404; malformed id 400"` | Tested |
| `POST /departures/:id/complete` | Departure status is not `IN_PROGRESS` | `409` | `{ error: "Cannot complete: departure status is ARRIVED, expected IN_PROGRESS" }` | `src/routes/trip.routes.test.ts`<br>`"2. Out-of-order transitions (depart before arrive, complete before depart, arrive twice) return 409"` | Tested |
| `POST /departures/:id/cancel` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/driver-cancellation.routes.test.ts`<br>`"3. Rejections: cancelling an IN_PROGRESS or COMPLETED departure returns 409; cancelling twice returns 409; another driver gets 403; a passenger gets 403; no token 401; unknown id 404."` | Tested |
| `POST /departures/:id/cancel` | Caller is not DRIVER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/driver-cancellation.routes.test.ts`<br>`"3. Rejections: cancelling an IN_PROGRESS or COMPLETED departure returns 409; cancelling twice returns 409; another driver gets 403; a passenger gets 403; no token 401; unknown id 404."` | Tested |
| `POST /departures/:id/cancel` | Malformed departure UUID | `400` | `{ error: "Invalid departure ID format" }` | `src/routes/driver-cancellation.routes.test.ts`<br>`"3. Rejections: cancelling an IN_PROGRESS or COMPLETED departure returns 409; cancelling twice returns 409; another driver gets 403; a passenger gets 403; no token 401; unknown id 404."` | Tested |
| `POST /departures/:id/cancel` | Departure row not found | `404` | `{ error: "Departure not found" }` | `src/routes/driver-cancellation.routes.test.ts`<br>`"3. Rejections: cancelling an IN_PROGRESS or COMPLETED departure returns 409; cancelling twice returns 409; another driver gets 403; a passenger gets 403; no token 401; unknown id 404."` | Tested |
| `POST /departures/:id/cancel` | Calling driver does not own the departure | `403` | `{ error: "Forbidden: you do not own this departure" }` | `src/routes/driver-cancellation.routes.test.ts`<br>`"3. Rejections: cancelling an IN_PROGRESS or COMPLETED departure returns 409; cancelling twice returns 409; another driver gets 403; a passenger gets 403; no token 401; unknown id 404."` | Tested |
| `POST /departures/:id/cancel` | Departure status is neither `SCHEDULED` nor `ARRIVED` (e.g. `IN_PROGRESS`, `COMPLETED`, `CANCELLED`) | `409` | `{ error: "Cannot cancel departure: status is IN_PROGRESS, expected SCHEDULED or ARRIVED" }` | `src/routes/driver-cancellation.routes.test.ts`<br>`"3. Rejections: cancelling an IN_PROGRESS or COMPLETED departure returns 409; cancelling twice returns 409; another driver gets 403; a passenger gets 403; no token 401; unknown id 404."` | Tested |
| `GET /reservations/:id` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/reservation.routes.test.ts`<br>`"returns 401 if unauthenticated"` | Tested |
| `GET /reservations/:id` | Malformed reservation UUID parameter | `400` | `{ error: "Invalid reservation ID format" }` | `src/routes/reservation.routes.test.ts`<br>`"returns 400 for invalid UUID format"` | Tested |
| `GET /reservations/:id` | Reservation row not found | `404` | `{ error: "Reservation not found" }` | `src/routes/reservation.routes.test.ts`<br>`"returns 404 if reservation does not exist"` | Tested |
| `GET /reservations/:id` | Caller is PASSENGER but does not own reservation | `403` | `{ error: "Forbidden: not your reservation" }` | `src/routes/reservation.routes.test.ts`<br>`"returns 403 if caller is Passenger B attempting to access Passenger A's reservation"` | Tested |
| `GET /reservations/:id` | Caller is DRIVER but does not own departure | `403` | `{ error: "Forbidden: not your departure" }` | `src/routes/reservation.routes.test.ts`<br>`"returns 403 if caller is Driver B attempting to access a reservation on Driver A's departure"` | Tested |
| `GET /reservations/:id` | Caller role is not PASSENGER or DRIVER (e.g. ADMIN) | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/reservation.routes.test.ts`<br>`"returns 403 if caller is ADMIN (only passenger owner or departure driver owner allowed)"` | Tested |
| `POST /reservations/:id/payments` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/payment.routes.test.ts`<br>`"rejects unauthenticated requests with 401"` | Tested |
| `POST /reservations/:id/payments` | Caller is not PASSENGER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/payment.routes.test.ts`<br>`"rejects non-PASSENGER roles with 403"` | Tested |
| `POST /reservations/:id/payments` | Malformed reservation UUID | `400` | `{ error: "Invalid reservation ID format" }` | `src/routes/payment.routes.test.ts`<br>`"rejects invalid reservation ID format with 400"` | Tested |
| `POST /reservations/:id/payments` | Reservation row not found | `404` | `{ error: "Reservation not found" }` | `src/routes/payment.routes.test.ts`<br>`"returns 404 when reservation does not exist"` | Tested |
| `POST /reservations/:id/payments` | Caller does not own the reservation | `403` | `{ error: "Forbidden: not your reservation" }` | `src/routes/payment.routes.test.ts`<br>`"rejects 403 when authenticated passenger is not the reservation's owner"` | Tested |
| `POST /reservations/:id/payments` | Reservation status != `PENDING_PAYMENT` or hold elapsed (`hold_expires_at <= now()`) | `409` | `{ error: "Reservation is no longer pending payment or hold has expired" }` | `src/routes/payment.routes.test.ts`<br>`"rejects 409 if reservation is not PENDING_PAYMENT (e.g. CONFIRMED)"`<br>`"rejects 409 if hold_expires_at has already passed and flips reservation to EXPIRED"` | Tested |
| `POST /reservations/:id/payments` | Payment with client-provided idempotency key already exists (constraint `23505`) | `409` | `{ error: "Payment with this idempotency key already exists" }` | `src/routes/payment.routes.test.ts`<br>`"returns 409 when POST /reservations/:id/payments is called twice with same client idempotencyKey"` | Tested |
| `POST /reservations/:id/payments` | Explicitly requesting `provider: "SIMULATED"` when simulated payments are disabled | `400` | `{ error: "Simulated payments are disabled" }` | `src/routes/paystack-initiate.routes.test.ts`<br>`"with NODE_ENV forced to \"production\" and ALLOW_SIMULATED_PAYMENTS \"true\", requesting SIMULATED gives 400 and no body gives PAYSTACK"` | Tested |
| `POST /reservations/:id/payments` | Request body specifies an invalid or unrecognized payment provider | `400` | `{ error: "Invalid payment provider" }` | `src/routes/paystack-initiate.routes.test.ts`<br>`"an invalid provider value gives 400"` | Tested |
| `POST /reservations/:id/payments` | Paystack provider requested but `PAYSTACK_SECRET_KEY` is missing or invalid live key (`sk_live_...`) | `503` | `{ error: "Paystack is not configured" }` | `src/routes/paystack-initiate.routes.test.ts`<br>`"a missing key gives 503"`<br>`"a live key (sk_live_x) gives 503"` | Tested |
| `POST /reservations/:id/payments` | Paystack checkout transaction initialization API request fails or returns non-200 | `502` | `{ error: "Payment provider unavailable" }` | `src/routes/paystack-initiate.routes.test.ts`<br>`"the fake failing gives 502 with the payment FAILED and the reservation still PENDING_PAYMENT"` | Tested |
| `POST /reservations/:id/cancel` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/cancellation.routes.test.ts`<br>`"5. Another passenger gets 403; a driver gets 403; no token 401; unknown id 404; malformed id 400."` | Tested |
| `POST /reservations/:id/cancel` | Caller is not PASSENGER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/cancellation.routes.test.ts`<br>`"5. Another passenger gets 403; a driver gets 403; no token 401; unknown id 404; malformed id 400."` | Tested |
| `POST /reservations/:id/cancel` | Malformed reservation UUID | `400` | `{ error: "Invalid reservation ID format" }` | `src/routes/cancellation.routes.test.ts`<br>`"5. Another passenger gets 403; a driver gets 403; no token 401; unknown id 404; malformed id 400."` | Tested |
| `POST /reservations/:id/cancel` | Reservation row not found | `404` | `{ error: "Reservation not found" }` | `src/routes/cancellation.routes.test.ts`<br>`"5. Another passenger gets 403; a driver gets 403; no token 401; unknown id 404; malformed id 400."` | Tested |
| `POST /reservations/:id/cancel` | Caller is not the reservation's passenger owner | `403` | `{ error: "Forbidden: not your reservation" }` | `src/routes/cancellation.routes.test.ts`<br>`"5. Another passenger gets 403; a driver gets 403; no token 401; unknown id 404; malformed id 400."` | Tested |
| `POST /reservations/:id/cancel` | Associated departure row not found under lock | `404` | `{ error: "Associated departure not found" }` | *Unreachable (foreign key constraint ensures reservations cannot reference a non-existent departure)* | Unreachable (foreign key) |
| `POST /reservations/:id/cancel` | Reservation status is not `CONFIRMED` (e.g. `PENDING_PAYMENT` or already `CANCELLED`) | `409` | `{ error: "Only a confirmed reservation can be cancelled" }` | `src/routes/cancellation.routes.test.ts`<br>`"4. 409 rejections: cancelling a PENDING_PAYMENT reservation; cancelling after departure_time has passed (set it in the past directly); cancelling once the departure is IN_PROGRESS."` | Tested |
| `POST /reservations/:id/cancel` | Departure time passed (`departure_time <= clock_timestamp()`) OR departure status not `SCHEDULED`/`ARRIVED` | `409` | `{ error: "Cannot cancel reservation: departure time has passed or trip is already in progress" }` | `src/routes/cancellation.routes.test.ts`<br>`"4. 409 rejections: cancelling a PENDING_PAYMENT reservation; cancelling after departure_time has passed (set it in the past directly); cancelling once the departure is IN_PROGRESS."` | Tested |
| `POST /payments/:id/callback` | Malformed payment UUID | `400` | `{ error: "Invalid payment ID format" }` | `src/routes/payment.routes.test.ts`<br>`"rejects invalid payment ID format with 400"` | Tested |
| `POST /payments/:id/callback` | Body validation failure: outcome is not `SUCCESS` or `FAILURE` | `400` | `{ error: "Invalid callback payload: outcome must be 'SUCCESS' or 'FAILURE'" }` | `src/routes/payment.routes.test.ts`<br>`"rejects invalid outcome value with 400"` | Tested |
| `POST /payments/:id/callback` | Payment row not found | `404` | `{ error: "Payment not found" }` | `src/routes/payment.routes.test.ts`<br>`"returns 404 when payment does not exist"` | Tested |
| `POST /payments/:id/callback` | Simulated callback invoked on a payment managed by Paystack provider | `403` | `{ error: "This payment is confirmed by the payment provider only" }` | `src/routes/paystack-webhook.routes.test.ts`<br>`"the simulated callback on a PAYSTACK payment gets 403"` | Tested |
| `POST /payments/:id/callback` | Simulated callback invoked when simulated payments are disabled (`NODE_ENV=production` or `ALLOW_SIMULATED_PAYMENTS` not enabled outside production) | `404` | `{ error: "Not found" }` | `src/routes/paystack-webhook.routes.test.ts`<br>`"with NODE_ENV forced to \"production\" the simulated callback gets 404"` | Tested |
| `POST /payments/:id/callback` | Associated reservation row not found | `404` | `{ error: "Associated reservation not found" }` | *Unreachable (foreign key constraint ensures payments cannot reference a non-existent reservation)* | Unreachable (foreign key) |
| `POST /payments/:id/callback` | Associated departure row not found | `404` | `{ error: "Associated departure not found" }` | *Unreachable (foreign key constraint ensures reservations cannot reference a non-existent departure)* | Unreachable (foreign key) |
| `POST /webhooks/paystack` | Missing or invalid `x-paystack-signature` HMAC SHA512 header signature | `401` | `{ error: "Invalid signature" }` | `src/routes/paystack-webhook.routes.test.ts`<br>`"a wrong signature gives 401 and the reservation stays PENDING_PAYMENT"`<br>`"a missing signature gives 401"` | Tested |
| `GET /payments/:id` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/payment-read.routes.test.ts`<br>`"no token 401"` | Tested |
| `GET /payments/:id` | Malformed payment UUID | `400` | `{ error: "Invalid payment ID format" }` | `src/routes/payment-read.routes.test.ts`<br>`"malformed id 400"` | Tested |
| `GET /payments/:id` | Payment row not found | `404` | `{ error: "Payment not found" }` | `src/routes/payment-read.routes.test.ts`<br>`"unknown id 404"` | Tested |
| `GET /payments/:id` | Caller is not the reservation's passenger owner (another passenger, driver, admin) | `403` | `{ error: "Forbidden: not your payment" }` | `src/routes/payment-read.routes.test.ts`<br>`"another passenger 403"`<br>`"a driver (including the departure's own driver) 403"`<br>`"admin 403"` | Tested |
| `GET /passengers/me/reservations` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/reservation.routes.test.ts`<br>`"returns 401 if unauthenticated"` | Tested |
| `GET /passengers/me/reservations` | Caller is not PASSENGER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/reservation.routes.test.ts`<br>`"returns 403 if caller is a DRIVER"`<br>`"returns 403 if caller is an ADMIN"` | Tested |
| `GET /passengers/me/notifications` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/access-control.routes.test.ts`<br>`"GET /passengers/me/notifications returns 401 without token"` | Tested |
| `GET /passengers/me/notifications` | Caller is not PASSENGER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/access-control.routes.test.ts`<br>`"GET /passengers/me/notifications returns 403 for DRIVER"`<br>`"GET /passengers/me/notifications returns 403 for ADMIN"` | Tested |
| `PATCH /notifications/:id/read` | Caller unauthenticated | `401` | `{ error: "Authentication token missing or invalid" }` | `src/routes/read-side.routes.test.ts`<br>`"1. Notifications: ownership, ordering (newest first), unread filter (?unread=true), and idempotent mark-read."` | Tested |
| `PATCH /notifications/:id/read` | Caller is not PASSENGER | `403` | `{ error: "Forbidden: insufficient permissions" }` | `src/routes/access-control.routes.test.ts`<br>`"PATCH /notifications/:id/read returns 403 for DRIVER"`<br>`"PATCH /notifications/:id/read returns 403 for ADMIN"` | Tested |
| `PATCH /notifications/:id/read` | Malformed notification UUID | `400` | `{ error: "Invalid notification ID format" }` | `src/routes/read-side.routes.test.ts`<br>`"1. Notifications: ownership, ordering (newest first), unread filter (?unread=true), and idempotent mark-read."` | Tested |
| `PATCH /notifications/:id/read` | Notification row not found | `404` | `{ error: "Notification not found" }` | `src/routes/read-side.routes.test.ts`<br>`"1. Notifications: ownership, ordering (newest first), unread filter (?unread=true), and idempotent mark-read."` | Tested |
| `PATCH /notifications/:id/read` | Notification belongs to another user | `403` | `{ error: "Forbidden: not your notification" }` | `src/routes/read-side.routes.test.ts`<br>`"1. Notifications: ownership, ordering (newest first), unread filter (?unread=true), and idempotent mark-read."` | Tested |

---

## 3. Flagged Untested & Unreachable Paths Summary

### A. Unreachable Paths (Invariants & Foreign Keys)
1. **Orphaned relations (`404`)**:
   - `Associated departure not found` in `POST /reservations/:id/cancel`: Invariant guaranteed by the Postgres foreign key `reservations.departure_id -> departures.id` (`ON DELETE RESTRICT/CASCADE`).
   - `Associated reservation not found` in `POST /payments/:id/callback`: Invariant guaranteed by foreign key `payments.reservation_id -> reservations.id`.
   - `Associated departure not found` in `POST /payments/:id/callback`: Invariant guaranteed by foreign key `reservations.departure_id -> departures.id`.
2. **`POST /departures/:id/depart` duplicate active trip (`409` catch on `23505`)**:
   - The partial unique index `idx_one_active_trip_per_driver` covers `(driver_id) WHERE status IN ('ARRIVED', 'IN_PROGRESS')`. Because the departure must already be `ARRIVED` to enter the departure transition, updating its status to `IN_PROGRESS` modifies the already-indexed row in place. It cannot violate the unique index or produce code `23505`.

### B. Untested Config Failures
1. **`JWT_SECRET` missing in server environment for `requireAuth` (`500`)**: Handled in `auth.middleware.ts` (`JWT_SECRET is not configured on server`).
