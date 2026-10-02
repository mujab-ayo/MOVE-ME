# MoveMe Backend (Week 2 Milestone)

Backend API for MoveMe — a scheduled and immediate ride-pooling platform designed for high-density commuter corridors in Lagos, Nigeria.

---

## 1. Prerequisites

- **Node.js**: v18.x or later (v20+ recommended)
- **npm**: v9.x or later
- **Neon PostgreSQL**: A free [Neon](https://neon.tech) serverless Postgres account (with support for `btree_gist` exclusion constraints).

> **Note on Docker:** This repository intentionally does **not** include a `Dockerfile`. As outlined in the Week 2 architectural decision checklist (`docs/design.md` Section 5), deployment uses native Node buildpacks on Render/Railway. This avoids containerization overhead and cross-platform virtualization issues while building natively from source.

---

## 2. Setup from a Clean Clone

Follow these exact steps after cloning the repository:

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Configure Environment Variables
Copy the example environment file:
```bash
cp .env.example .env
```

Open `.env` and fill in your values:
```env
DATABASE_URL=postgresql://<user>:<password>@<neon-host>/neondb?sslmode=require
JWT_SECRET=your_secure_development_jwt_secret_here
PORT=3000
```

### Step 3: Run Database Migrations
Apply the TypeORM migrations against your Neon database to create tables (`users`, `vehicles`, `routes`, `departures`) and interval exclusion constraints:
```bash
npm run migrate
```
*(Alternative TypeORM command: `npm run migration:run`)*

### Step 4: Seed Fixed Routes
Seed the fixed high-demand Lagos commuter routes (`Ikeja <-> VI`, `Lekki <-> Airport`, `Yaba <-> Marina`):
```bash
npm run seed
```

---

## 3. Running the Server

### Development Mode
Runs the TypeScript server with hot-reloading via `ts-node-dev`:
```bash
npm run dev
```
The server will start on `http://localhost:3000` (or your configured `PORT`).

### Production Build & Start
Compile TypeScript to JavaScript and run the compiled bundle:
```bash
npm run build
npm start
```

### Health Check Verification
Verify the server is running:
```bash
curl http://localhost:3000/health
# Response: {"status":"ok"}
```

---

## 4. Running Tests

Testing uses Jest, `ts-jest`, and Supertest against a live Postgres test database.

### Important: Configure `.env.test`
`npm test` executes with `NODE_ENV=test` via `cross-env` and loads `.env.test`.

Create `.env.test` by copying `.env.example`:
```bash
cp .env.example .env.test
```

> **Critical Database Separation Rule:**
> `.env.test` must point at a separate, dedicated Neon database branch (never development or production) because the test suite executes destructive `DELETE` operations before and after test suites to maintain clean test isolation.

### Run Test Suite
```bash
npm test
```
All integration test suites (`auth`, `driver_and_admin`, `departure`, `middleware`, `health`) will run sequentially (`maxWorkers: 1`).

---

## 5. API Demonstration & Worked Examples

A complete [requests.http](file:///c:/Users/HP/Desktop/MOVE%20ME/requests.http) file is included at the repository root. You can execute these requests directly in VS Code (with the REST Client extension), JetBrains IDEs, or Antigravity IDE:

1. **Register Passenger**: `POST /auth/register/passenger`
2. **Register Driver**: `POST /auth/register/driver` (default: `driver_enabled = false`)
3. **Login (Passenger, Driver, Admin)**: `POST /auth/login` (returns signed JWT)
4. **Register Vehicle**: `POST /drivers/me/vehicles`
5. **List My Vehicles**: `GET /drivers/me/vehicles` (verifies data ownership boundary)
6. **Admin List Pending Drivers**: `GET /admin/drivers?status=pending`
7. **Admin Enable Driver**: `PATCH /admin/drivers/:id/enable` (unlocks publishing)
8. **Publish Departure**: `POST /departures` (validates driver enablement, vehicle ownership, and non-overlapping schedules)
9. **Ride Discovery (Immediate)**: `GET /departures/search?routeId=...&mode=SOLO&when=immediate` (15-min window)
10. **Ride Discovery (Scheduled)**: `GET /departures/search?routeId=...&mode=POOLED&when=scheduled&datetime=...` (filters `departure_time >= datetime AND departure_time > now()`)

---

## 6. Shared-Environment Deployment (Render / Railway)

To satisfy the Week 2 shared-environment demo requirement, connect this repository to Render (or Railway) using their native Node buildpack:

### Step 1: Create a Web Service
- Link your GitHub repository to [Render](https://render.com) (or [Railway](https://railway.app)).
- Select **Web Service** with runtime **Node**.

### Step 2: Configure Build & Start Commands
- **Build Command**:
  ```bash
  npm install && npm run build
  ```
- **Start Command**:
  ```bash
  npm start
  ```

### Step 3: Configure Environment Variables
In the service's Environment settings, add:
- `DATABASE_URL`: Connection string for your **Production** Neon branch (do **not** use the test branch).
- `JWT_SECRET`: A long, randomly generated secret string.
- `NODE_ENV`: `production`
- `PORT`: `10000` (Render default; Render injects `PORT` automatically).

### Step 4: Post-Deploy Database Setup (Crucial)
Once the service deploys, the database must have migrations applied and routes seeded before the API can serve requests:
1. Open the Render **Shell** tab (or run via Render One-Off Job / CLI):
   ```bash
   npm run migrate
   node dist/seed/routes.js
   ```
2. Enable at least one driver:
   - Register a driver via `POST /auth/register/driver`.
   - Update the driver row in Neon or via admin endpoint:
     ```sql
     UPDATE users SET driver_enabled = true WHERE email = 'driver@example.com';
     ```
   - Register a vehicle for this driver via `POST /drivers/me/vehicles`.
   - The driver is now ready to publish departures that passengers can discover!
