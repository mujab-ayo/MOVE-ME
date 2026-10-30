# MoveMe Web Interface (`/app`)

The MoveMe frontend is a lightweight, responsive web application served directly from the Express backend without external frameworks, build tools, CDNs, or external dependencies.

---

## 1. Opening the Interface

The interface is served statically at `/app` (or `/app/`):

- **Standard Access**: [http://localhost:3000/app/](http://localhost:3000/app/)  
  Presents the standard authentication screen with tabbed Login, Passenger Registration, and Driver Registration forms.
- **Demo Mode**: [http://localhost:3000/app/?demo=1](http://localhost:3000/app/?demo=1)  
  Activates demo shortcut buttons (**Fill admin**, **Fill driver**, **Fill passenger**) that instantly populate the login inputs with seeded credentials.

---

## 2. User Roles and Capabilities

The platform implements strict role-based access control (RBAC):

| Role | Permissions & Workflows |
|---|---|
| **PASSENGER** | Search departures (immediate *"Leaving now"* or scheduled date/time); hold seats on active departures; complete card payments via Paystack test checkout (or simulated payments when enabled in development) within a 10-minute hold window; monitor active reservations with live progress steppers; cancel reservations for automated refunds; receive and read real-time notifications. |
| **DRIVER** | Register fleet vehicles with seat capacities; publish `SOLO` or `POOLED` departures on active routes (with quick shortcuts for *"Tomorrow 09:00"* and *"In 10 minutes"*); advance departure lifecycles through `SCHEDULED` &rarr; `ARRIVED` &rarr; `IN_PROGRESS` &rarr; `COMPLETED`; cancel departures with automatic passenger refunds. |
| **ADMIN** | Administrative console for verifying prospective drivers. Fetches pending drivers awaiting clearance and enables driver publishing privileges with a single click. |

---

## 3. Suggested Five-Minute Demo Order

Using the accounts created by `npm run seed:demo`:

### Step 1: Admin Approval (Optional / Verification)
1. Navigate to `http://localhost:3000/app/?demo=1`.
2. Click **Fill admin** (or enter `admin@example.com` / `AdminPassword123!`) and click **Log in**.
3. View the **Admin Console**. The table lists prospective drivers pending approval (`GET /admin/drivers?status=pending`).
4. Click **Enable** on any pending driver to activate their account (`PATCH /admin/drivers/:id/enable`).
5. Click **Log out** in the header.

### Step 2: Driver Publishes a Departure
1. On the login screen, click **Fill driver** (`driver1@example.com` / `DriverPassword123!`) and click **Log in**.
2. **Vehicles Tab**: Review the registered vehicle (`LND-123-AB`, 4 seats). You can also add a new vehicle using the form below.
3. **Publish Tab**:
   - Choose a Route (e.g. *"Ikeja to Victoria Island"*).
   - Select your vehicle.
   - Choose Mode (`POOLED`).
   - Click the **"In 10 minutes"** shortcut button (this ensures the trip is immediately discoverable in *"Leaving now"* searches).
   - Click **Publish Departure**. A success banner displays the scheduled departure time and fare.
4. **My Departures Tab**: Observe your newly published departure card with `SCHEDULED` status and 4 seats available.
5. Click **Log out**.

### Step 3: Passenger Searches, Books, and Pays (Paystack Flow)
1. Click **Fill passenger** (`passenger1@example.com` / `PassengerPassword123!`) and click **Log in**.
2. **Search Tab**:
   - Select the route *"Ikeja to Victoria Island"*.
   - Keep the toggle on **"Leaving now"** and click **Search Departures**.
   - Your published departure appears in the results with fare, mode, and available seats.
   - Click **Book**.
3. **Book and Pay Tab (Payment Flow)**:
   - A 10-minute reservation hold is initiated (`PENDING_PAYMENT`).
   - Observe the live countdown timer ticking down to `hold_expires_at`.
   - Click **Pay with Paystack**:
     - The browser opens a blank window synchronously inside the click handler to prevent popup blocking.
     - The frontend calls `POST /reservations/:id/payments` with no body.
     - When the server returns `{ checkoutUrl, ... }`, the popup window navigates directly to the Paystack checkout page.
     - While checkout is active, the card shows **"Waiting for payment confirmation..."** alongside the live hold countdown.
     - The frontend polls `GET /reservations/:id` every 3 seconds (pausing while the tab is hidden). An **"I have paid, check now"** button triggers an immediate status check.
     - Once confirmed via webhook or redirect callback, status updates to `CONFIRMED`, a green toast announces **"Payment confirmed"**, and the view reloads **My trips**.
     - If the hold expires or countdown reaches zero, the card displays **"The hold expired; no seat was reserved"** and polling ceases.
     - *(Development Fallback)*: If the server response has no `checkoutUrl` and provider is `SIMULATED` (when `ALLOW_SIMULATED_PAYMENTS=true` in development), the popup closes and the card presents today's two simulated buttons: **Pay (simulate success)** and **Simulate failed payment**. In production, only the Paystack flow appears.
4. **My Trips Tab**:
   - View your confirmed trip card with the interactive lifecycle stepper indicating `SCHEDULED`.
   - Expand **Details & Payment Receipt** to inspect the payment status in plain words (`Succeeded`, `Refund processing`, etc.).
   - To cancel before departure: click **Cancel Reservation**. When cancelling a Paystack payment, the UI announces `"Refund of NGN X requested; processing"` and polls `GET /payments/:id` every 3 seconds for up to 60 seconds until updated to `"Refunded"` (or `"Refund could not be processed; contact support"` if failed).

### Step 4: Driver Lifecycle Actions & Passenger Notifications
1. In another browser tab (or after logging back in as driver):
   - Navigate to **My departures**.
   - Click **"I have arrived"** &rarr; status updates to `ARRIVED`.
   - Click **"Start trip"** &rarr; status updates to `IN_PROGRESS`.
   - Click **"Complete trip"** &rarr; status updates to `COMPLETED`.
2. As the passenger, check the **Notifications** tab:
   - Unread count badge updates dynamically.
   - Review incoming trip lifecycle notifications (*"Your driver has arrived"*, *"Your trip is now in progress"*, *"Your trip has been completed"*).
   - Click **Mark read** on unread notifications.

---

## 4. Frontend API Endpoints Table

The following table documents all endpoints invoked by the web application:

| Method | Endpoint | Role | Description & Frontend Behavior | Notes |
|---|---|---|---|---|
| `POST` | `/auth/login` | Public | Authenticates passenger, driver, or admin; stores JWT in `sessionStorage`. | |
| `POST` | `/auth/register` | Public | Registers a new passenger or prospective driver. | |
| `GET` | `/routes` | Any | Retrieves active routes to populate dropdowns and route badges. | Cached per session |
| `GET` | `/departures` | Any | Searches departures matching route, mode, and scheduled departure window. | |
| `POST` | `/departures` | DRIVER | Publishes a new SOLO or POOLED departure for an approved driver vehicle. | |
| `GET` | `/drivers/me/departures` | DRIVER | Lists driver's departures with available seats and passenger roster. | |
| `POST` | `/departures/:id/arrive` | DRIVER | Transitions departure from `SCHEDULED` to `ARRIVED`. | Notifies passengers |
| `POST` | `/departures/:id/start` | DRIVER | Transitions departure from `ARRIVED` to `IN_PROGRESS`. | Notifies passengers |
| `POST` | `/departures/:id/complete` | DRIVER | Transitions departure from `IN_PROGRESS` to `COMPLETED`. | Notifies passengers |
| `POST` | `/departures/:id/cancel` | DRIVER | Driver cancels departure; triggers automated passenger refunds. | |
| `GET` | `/vehicles` | DRIVER | Lists vehicles owned by authenticated driver. | |
| `POST` | `/vehicles` | DRIVER | Registers a new vehicle with registration plate and seat capacity. | |
| `POST` | `/departures/:id/reservations` | PASSENGER | Holds a seat on departure; returns 10-minute hold reservation. | Initiates hold window |
| `GET` | `/passengers/me/reservations` | PASSENGER | Fetches passenger's reservations (for Book & Pay and My Trips tabs). | |
| `GET` | `/reservations/:id` | PASSENGER | Fetches reservation details; polled every 3s during Paystack checkout hold. | Pauses when tab is hidden |
| `POST` | `/reservations/:id/payments` | PASSENGER | Initiates Paystack payment; returns `checkoutUrl` and provider reference. | Called with no body |
| `POST` | `/payments/:id/callback` | PASSENGER | **Simulated payments only; not available in production.** Triggers outcome simulation (`SUCCESS` or `FAILURE`). | **Disabled in production**; requires `ALLOW_SIMULATED_PAYMENTS=true` |
| `GET` | `/payments/:id` | PASSENGER | Fetches payment details; polled every 3s (up to 60s) for refund status after cancellation. | |
| `POST` | `/reservations/:id/cancel` | PASSENGER | Passenger cancels confirmed reservation before departure; requests Paystack refund. | |
| `GET` | `/payments/return` | Public | Browser landing page after Paystack checkout redirection. | Informs user to return to app |
| `GET` | `/passengers/me/notifications` | PASSENGER | Retrieves notifications; unread count polls every 10 seconds. | Background polling |
| `PATCH` | `/notifications/:id/read` | PASSENGER | Marks a single notification as read; updates unread badge counter. | |
| `GET` | `/admin/drivers` | ADMIN | Lists prospective drivers filtered by clearance status (`pending`). | |
| `PATCH` | `/admin/drivers/:id/enable` | ADMIN | Clears driver background verification and enables publishing permissions. | |

---

## 5. File Layout of `public/`

The frontend files are organized cleanly in `public/`:

```
public/
├── index.html           # Single HTML shell: header, user profile, main viewport, toast container, API log drawer
├── styles.css           # Vanilla CSS design system: responsive layout, accessible :focus-visible, status badge colors
└── js/
    ├── api.js           # API client wrapper: automatic Authorization headers, error propagation, network call logger
    ├── ui.js            # DOM utility: safe element builder (textContent only), toast notifications, UTC time formatting
    ├── app.js           # Entry point: session initialization, login/registration forms, role router, API log drawer
    ├── passenger.js     # Passenger portal: search departures, reservation hold & countdown, Paystack payment, trips, notifications
    ├── driver.js        # Driver portal: vehicles table, departure publisher, departure lifecycle controls, cancellation
    └── admin.js         # Admin console: pending driver approval list, enablement actions, real-time table refresh
```

---

## 6. Known Limits and Design Characteristics

1. **Payment Processing (Paystack Test Mode & Simulated Mode)**:  
   MoveMe integrates Paystack in test mode with card checkouts (`POST /reservations/:id/payments`), webhook verification (`POST /webhooks/paystack`), and asynchronous refunds (`POST /reservations/:id/cancel`). For offline or local development without Paystack API credentials, simulated payments (`POST /payments/:id/callback`) remain available only when `ALLOW_SIMULATED_PAYMENTS=true` is set.
2. **Timezone Representation**:  
   All timestamps stored and returned by the database and API are in strict UTC ISO-8601 format. The UI translates dates and times into the viewer's local browser timezone for intuitive reading, while preserving the exact UTC representation in the tooltip (`title` attribute) and `datetime` attribute.
3. **Data Refresh & Polling**:  
   To minimize unnecessary network traffic and database load, table views and trip lists refresh deterministically upon user action (e.g., booking, status advancement, cancellation) or upon clicking the explicit **↻ Refresh** buttons. Active reservation holds poll every 3 seconds while checkout is pending (pausing when the tab is hidden), post-cancellation refunds poll for up to 60 seconds, and notification unread counters poll on a lightweight 10-second interval.
4. **Client-Side Security**:  
   Authentication tokens and session identifiers are stored in `sessionStorage` rather than `localStorage` so sessions terminate when the browser tab closes. All server-supplied data is injected exclusively via DOM text nodes (`textContent`), strictly avoiding `innerHTML` vulnerabilities.
