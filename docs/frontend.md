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
| **PASSENGER** | Search departures (immediate *"Leaving now"* or scheduled date/time); hold seats on active departures; complete simulated card payments within a 10-minute hold window; monitor active reservations with live progress steppers; cancel reservations for refunds; receive and read real-time notifications. |
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

### Step 3: Passenger Searches, Books, and Pays
1. Click **Fill passenger** (`passenger1@example.com` / `PassengerPassword123!`) and click **Log in**.
2. **Search Tab**:
   - Select the route *"Ikeja to Victoria Island"*.
   - Keep the toggle on **"Leaving now"** and click **Search Departures**.
   - Your published departure appears in the results with fare, mode, and available seats.
   - Click **Book**.
3. **Book and Pay Tab**:
   - A 10-minute reservation hold is initiated (`PENDING_PAYMENT`).
   - Observe the live countdown timer ticking down to `hold_expires_at`.
   - Click **Simulate Successful Payment**. The payment is recorded, and the reservation status turns green (`CONFIRMED`).
4. **My Trips Tab**:
   - View your confirmed trip card.
   - The interactive trip stepper indicates `SCHEDULED`.
   - Expand **Details & Payment Receipt** to inspect the server-verified payment receipt.

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

## 4. File Layout of `public/`

The frontend files are organized cleanly in `public/`:

```
public/
├── index.html           # Single HTML shell: header, user profile, main viewport, toast container, API log drawer
├── styles.css           # Vanilla CSS design system: responsive layout, accessible :focus-visible, status badge colors
└── js/
    ├── api.js           # API client wrapper: automatic Authorization headers, error propagation, network call logger
    ├── ui.js            # DOM utility: safe element builder (textContent only), toast notifications, UTC time formatting
    ├── app.js           # Entry point: session initialization, login/registration forms, role router, API log drawer
    ├── passenger.js     # Passenger portal: search departures, reservation hold & countdown, payment, trips, notifications
    ├── driver.js        # Driver portal: vehicles table, departure publisher, departure lifecycle controls, cancellation
    └── admin.js         # Admin console: pending driver approval list, enablement actions, real-time table refresh
```

---

## 5. Known Limits and Design Characteristics

1. **Simulated Payments**:  
   MoveMe operates in sandbox/demonstration mode. Real payment gateways (e.g. Paystack, Stripe) are not connected. Successful and failed card payments are simulated locally via backend payment endpoints.
2. **Timezone Representation**:  
   All timestamps stored and returned by the database and API are in strict UTC ISO-8601 format. The UI translates dates and times into the viewer's local browser timezone for intuitive reading, while preserving the exact UTC representation in the tooltip (`title` attribute) and `datetime` attribute.
3. **Data Refresh & Polling**:  
   To minimize unnecessary network traffic and database load, table views and trip lists refresh deterministically upon user action (e.g., booking, status advancement, cancellation) or upon clicking the explicit **↻ Refresh** buttons. Only the passenger notification count badge polls automatically on a lightweight 10-second background interval.
4. **Client-Side Security**:  
   Authentication tokens and session identifiers are stored in `sessionStorage` rather than `localStorage` so sessions terminate when the browser tab closes. All server-supplied data is injected exclusively via DOM text nodes (`textContent`), strictly avoiding `innerHTML` vulnerabilities.
