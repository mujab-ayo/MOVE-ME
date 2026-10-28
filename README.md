# MoveMe

MoveMe is a high-concurrency commuter ride-pooling platform designed for high-density transport corridors in Lagos, Nigeria. The platform allows drivers to register vehicles and schedule SOLO or POOLED departures on fixed routes, while passengers discover rides, place deterministic reservation holds, and complete simulated fare payments. Built with rigorous database-level isolation guarantees, the system prevents seat double-allocations and driver schedule conflicts under concurrent traffic.

### Tech Stack

- **Runtime & Language**: Node.js (v18+ supported, v20+ LTS recommended), TypeScript 5.7
- **Web Framework**: Express 5.2
- **Database & Driver**: PostgreSQL on Neon (Serverless Postgres with `btree_gist` extension), `pg` driver
- **ORM & Migrations**: TypeORM 1.1 (`typeorm-ts-node-commonjs`)
- **Authentication & Security**: Argon2 password hashing (`argon2`), signed JSON Web Tokens (`jsonwebtoken`)
- **Schema Validation**: Zod 4.6
- **API Documentation**: OpenAPI 3.0 via `swagger-jsdoc` and `swagger-ui-express`
- **Testing**: Jest 30, `ts-jest`, Supertest
- **Frontend**: Zero-dependency vanilla ES6 modules, CSS3, and HTML5 served statically at `/app`

---

## 1. Prerequisites

1. **Node.js & npm**:
   - Node.js version: **v18.x or later** (Node.js **v20.x or v22.x LTS** recommended).
   - npm version: **v9.x or later**.
2. **Neon PostgreSQL Account**:
   - Sign up for a free serverless PostgreSQL account at [Neon](https://neon.tech).
   - Create a project with **two separate branches**:
     - **`main`** (or development/production branch): Used for active development, staging, and live application data.
     - **`test`**: A dedicated, isolated branch used exclusively by the automated integration test suite.
   - Both branches must support PostgreSQL extensions (specifically `btree_gist` for GiST exclusion constraints), which are enabled automatically via the project migrations.

---

## 2. Environment Files

The repository relies on two distinct environment configuration files at the project root:

- **`.env`**: Configures local development and production execution (`npm run dev`, `npm start`, and migrations/seeds against your dev database).
- **`.env.test`**: Configures automated test execution (`npm test`).

### Why They Must Point at Different Databases

The automated test suite executes **destructive operations** (table-level deletes, deterministic concurrency races, and state resets) between test suites to ensure absolute test isolation. If `.env.test` were to point at your development or production database branch, **all application data, registered vehicles, departures, and user accounts would be permanently destroyed**.

### The Safety Guard in `jest.global-setup.js`

To prevent accidental data loss, [jest.global-setup.js](file:///c:/Users/HP/Desktop/MOVE%20ME/jest.global-setup.js) runs before any test suite starts and enforces four strict assertions:
1. `NODE_ENV` must be set to `test`.
2. `HOLD_MINUTES` must **not** be set in `process.env`. `HOLD_MINUTES` is strictly for development and visual demonstration (allowing short hold timeouts to illustrate seat expiration). The test suite requires the standard 10-minute hold window for deterministic race tests; if `HOLD_MINUTES` is detected, the test runner aborts immediately.
3. The database host parsed from `.env.test` must **not** match the host in `.env`. If both point to the same database host, the test run aborts immediately.
4. The active host in `process.env.DATABASE_URL` must match `.env.test`. If a leftover `DATABASE_URL` in the parent shell environment overrides `.env.test`, the test run aborts immediately.

### Environment Variables in `.env.example`

Copy [.env.example](file:///c:/Users/HP/Desktop/MOVE%20ME/.env.example) to create `.env` and `.env.test`:
```bash
cp .env.example .env
cp .env.example .env.test
```

Every variable defined in `.env.example`:
- `DATABASE_URL`: Full PostgreSQL connection string (including username, password, host, port, database name, and `?sslmode=require`).
  - Example: `postgresql://username:password@ep-sample-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require`
- `JWT_SECRET`: A long, cryptographically random secret string used to sign and verify HMAC-SHA256 JWT access tokens.
- `PORT`: The local HTTP port on which the Express server listens (default: `3000`).

*(Note on `HOLD_MINUTES`: As stated above, this optional variable can be placed in `.env` during manual development to test hold expiration quickly, but must never be set in `.env.test` or exported in a test shell).*

### Git-Ignored Confirmation

Both `.env` and `.env.test` are strictly ignored by Git via [.gitignore](file:///c:/Users/HP/Desktop/MOVE%20ME/.gitignore) to safeguard credentials. You can confirm this with `git check-ignore`:
```bash
git check-ignore .env .env.test
# Output:
# .env
# .env.test
```

---

## 3. Install

Install all production and development dependencies:

```bash
npm install
```

---

## 4. Migrations

Database schema definition and constraint enforcement are managed using TypeORM migrations located in [src/migrations/](file:///c:/Users/HP/Desktop/MOVE%20ME/src/migrations/).

### Running Migrations on the Test Branch

Always migrate your dedicated test database branch before running tests:
```bash
npx cross-env NODE_ENV=test npm run migration:run
```
*(This loads `.env.test` and applies all schema tables, GiST interval exclusion constraints, and partial indexes).*

### Running Migrations on Development / Production

To apply migrations against the database configured in `.env`:
```bash
npm run migration:run
```
*(Alternative alias: `npm run migrate`).*

### How to Revert a Migration

To roll back the single most recently executed migration:
- **On Development / Production** (`.env`):
  ```bash
  npm run migration:revert
  ```
- **On Test Database** (`.env.test`):
  ```bash
  npx cross-env NODE_ENV=test npm run migration:revert
  ```

### The Golden Rule of Database Migrations

> **"Migrate production before pushing code that needs the change."**  
> Never deploy code that expects new tables, columns, or database constraints before the migration has executed successfully against the target production database.

---

## 5. Seed

Seeding scripts populate active routes and initial accounts. **Seeding is executed from your local machine against the database specified in `.env`**.

### Standard Route Seeding (`npm run seed`)

Executes [src/seed/routes.ts](file:///c:/Users/HP/Desktop/MOVE%20ME/src/seed/routes.ts) using `ts-node-dev`:
```bash
npm run seed
```
Creates the standard, active commuter routes across Lagos:
1. **Ikeja to Victoria Island** (45 min, ₦1,500)
2. **Lekki Phase 1 to Muritala Muhammed Airport** (60 min, ₦2,500)
3. **Yaba to Marina** (30 min, ₦1,000)

*(For compiled production environments, the equivalent command is `npm run seed:prod`, which runs [dist/seed/routes.js](file:///c:/Users/HP/Desktop/MOVE%20ME/dist/seed/routes.js)).*

### Demo Seed (`npm run seed:demo`)

Executes [src/seed/demo.ts](file:///c:/Users/HP/Desktop/MOVE%20ME/src/seed/demo.ts) using `ts-node-dev`:
```bash
npm run seed:demo
```
This command ensures the active routes exist, registers an initial demo vehicle, and seeds three test user accounts:

| Role | Email | Password | Details |
|---|---|---|---|
| **ADMIN** | `admin@example.com` | `AdminPassword123!` | Privileged administrator account. **The admin account exists ONLY because of `seed:demo` (there is no public admin registration route in the API).** |
| **DRIVER** | `driver1@example.com` | `DriverPassword123!` | Pre-enabled driver (`driver_enabled = true`) owning vehicle `LND-123-AB` (Toyota Corolla, 4 seats). |
| **PASSENGER** | `passenger1@example.com` | `PassengerPassword123!` | Standard commuter passenger account. |

---

## 6. Run

### Development Mode

Starts the TypeScript server with live reloading on file changes using `ts-node-dev`:
```bash
npm run dev
```
The server starts at `http://localhost:3000` (or your configured `PORT`).

### Production Build & Start

Compile TypeScript into JavaScript and run the production server:
```bash
npm run build
npm start
```
- `npm run build`: Runs `tsc` to emit compiled JavaScript to [dist/](file:///c:/Users/HP/Desktop/MOVE%20ME/dist/).
- `npm start`: Runs `node dist/index.js`.

### Verify Health Endpoint

Verify that the HTTP server and database connection are operational:
```bash
curl http://localhost:3000/health
# Response: {"status":"ok"}
```

---

## 7. Tests

The automated test suite runs via Jest against the isolated test database configured in `.env.test`.

### Running the Test Suite

```bash
npm test
```
This executes `cross-env NODE_ENV=test jest`.

### Expected Counts and Runtime

As recorded in [docs/regression-results.md](file:///c:/Users/HP/Desktop/MOVE%20ME/docs/regression-results.md):
- **Test Suites**: 20 suites (up to 21 suites including low-level DB constraint integration).
- **Tests**: 228 passing tests (up to 232 tests total).
- **Expected Runtime**: Approximately **920 seconds (~15.3 minutes)**.

### Why the Test Suite Is Slow

The test suite does **not** mock the database or run against an in-memory SQLite surrogate. Every single test operates against a live, remote serverless PostgreSQL instance on Neon (hosted on AWS in `us-east-2`) over encrypted TLS connections (`sslmode=require`). Tests validate real transaction isolation, physical table row locks (`SELECT ... FOR UPDATE`), temporal range overlaps (`tstzrange` exclusion constraints via GiST indexes), and deterministic multithreaded race conditions. The network latency of hundreds of round-trips over TLS accounts for the ~15 minute execution time.

### Check and Report Scripts in `package.json`

- **`npm run check:docs`**: Executes [scripts/check-exception-doc.js](file:///c:/Users/HP/Desktop/MOVE%20ME/scripts/check-exception-doc.js). Verifies that every HTTP status code returned in route handlers matches the specification in [docs/exception-handling.md](file:///c:/Users/HP/Desktop/MOVE%20ME/docs/exception-handling.md).
- **`npm run check:openapi`**: Executes [scripts/check-openapi.js](file:///c:/Users/HP/Desktop/MOVE%20ME/scripts/check-openapi.js). Validates route Swagger JSDoc comments against OpenAPI standards and application schemas.
- **`npm run export:openapi`**: Executes [scripts/export-openapi.js](file:///c:/Users/HP/Desktop/MOVE%20ME/scripts/export-openapi.js). Exports the live Swagger definition to static [docs/openapi.json](file:///c:/Users/HP/Desktop/MOVE%20ME/docs/openapi.json).
- **`npm run report:regression`**: Executes [scripts/report-regression.js](file:///c:/Users/HP/Desktop/MOVE%20ME/scripts/report-regression.js). Runs the full test suite with JSON telemetry, maps results against requirements in [docs/requirement-map.json](file:///c:/Users/HP/Desktop/MOVE%20ME/docs/requirement-map.json), inspects live PostgreSQL constraints, and outputs [docs/regression-results.md](file:///c:/Users/HP/Desktop/MOVE%20ME/docs/regression-results.md).

---

## 8. API Documentation and Web Interface

### Interactive Swagger UI (`/docs`)

Access interactive API documentation at:
- [http://localhost:3000/docs](http://localhost:3000/docs) (or `/docs/`)
- Raw OpenAPI JSON specification is served at: [http://localhost:3000/docs.json](http://localhost:3000/docs.json).

### OpenAPI Specification File (`docs/openapi.json`)

The complete static OpenAPI 3.0 specification is maintained in [docs/openapi.json](file:///c:/Users/HP/Desktop/MOVE%20ME/docs/openapi.json). It documents all request bodies, responses, status codes, query parameters, and Bearer authentication schemes.

### Postman Collection (`docs/postman/MoveMe.postman_collection.json`)

A ready-to-use Postman collection is included in the repository at:
- **Path**: [docs/postman/MoveMe.postman_collection.json](file:///c:/Users/HP/Desktop/MOVE%20ME/docs/postman/MoveMe.postman_collection.json)

**How to Import into Postman**:
1. Open Postman.
2. Click **Import** in the top-left corner.
3. Drag and drop [docs/postman/MoveMe.postman_collection.json](file:///c:/Users/HP/Desktop/MOVE%20ME/docs/postman/MoveMe.postman_collection.json) (or click *Choose Files*).
4. Set the `baseUrl` collection variable to `http://localhost:3000` (or your deployed cloud URL).

### Web Interface (`/app`)

The repository includes a fully functional, zero-dependency responsive frontend located in [public/](file:///c:/Users/HP/Desktop/MOVE%20ME/public/):
- **Web App URL**: [http://localhost:3000/app/](http://localhost:3000/app/)
- **Demo Mode**: [http://localhost:3000/app/?demo=1](http://localhost:3000/app/?demo=1) provides one-click demo login buttons (**Fill admin**, **Fill driver**, **Fill passenger**) to populate seeded credentials immediately.
- Comprehensive user interface workflows and architecture are documented in [docs/frontend.md](file:///c:/Users/HP/Desktop/MOVE%20ME/docs/frontend.md).

---

## 9. Deploying on Render

MoveMe is configured for deployment on [Render](https://render.com) using native Node buildpacks.

### Step 1: Create Web Service on Render

1. Connect your GitHub repository to Render.
2. Create a new **Web Service** using the **Node** environment.
3. Specify the build and start commands:
   - **Build Command**:
     ```bash
     npm install && npm run build
     ```
   - **Start Command**:
     ```bash
     npm start
     ```

### Step 2: Configure Environment Variables in Render Dashboard

In the **Environment** settings of your Render Web Service, add:
- `DATABASE_URL`: The connection string for your **production** Neon database branch (including `?sslmode=require`).
- `JWT_SECRET`: A long, randomly generated secret key.
- `NODE_ENV`: `production`
- *(Note: Render automatically injects and binds the `PORT` variable).*

### Step 3: Run Migrations and Seeding from Your Own Machine

Render's free tier does not provide a terminal Shell. Therefore, database migrations and initial seeding must be run **from your own machine** in a fresh terminal before the web service handles production traffic:

1. Open a new terminal on your local machine.
2. Temporarily set `.env` (or configure your shell) to point `DATABASE_URL` at your **production** Neon database.
3. Apply database migrations:
   ```bash
   npm run migration:run
   ```
4. Seed active commuter routes:
   ```bash
   npm run seed
   ```
5. Deploy or push your code to GitHub.

> **CRITICAL REMINDERS FOR DEPLOYMENT:**
> - **Never run `npm test` against the production database.**
> - **Always apply database migrations to production first, then push the code that needs the change.**

---

## 10. Troubleshooting

The table below outlines real failure modes encountered during development, their underlying causes, and direct fixes:

| Failure Mode | Root Cause | Resolution |
|---|---|---|
| **`Check failed: The database host in .env.test equals the host in .env`** | Both `.env` and `.env.test` share the same database host. The safety guard in `jest.global-setup.js` blocked execution to protect development data. | Create a separate branch in your Neon console (e.g. `test`). Update `DATABASE_URL` in `.env.test` with the test branch connection string. |
| **`Check failed: The active host in process.env.DATABASE_URL differs from .env.test`** | A lingering `DATABASE_URL` was exported in your terminal session, overriding the `.env.test` configuration. | Clear the shell environment variable: in PowerShell run `Remove-Item Env:DATABASE_URL`; in Bash run `unset DATABASE_URL`. Open a fresh terminal before re-running `npm test`. |
| **`Check failed: HOLD_MINUTES is set in process.env`** | `HOLD_MINUTES` was exported in your shell or set in the test environment, which distorts hold expiration test timings. | Clear the variable: in PowerShell run `Remove-Item Env:HOLD_MINUTES`; in Bash run `unset HOLD_MINUTES`. Ensure `HOLD_MINUTES` is deleted from `.env.test`. |
| **Test timeout errors (`exceeded timeout of 5000 ms`)** | Network latency to the remote Neon PostgreSQL instance or a serverless cold start exceeded Jest's threshold. | The test suite is configured with `maxWorkers: 1` and generous per-test timeouts. If your connection suffers temporary latency, re-run the individual suite: `npx jest src/routes/<suite>.test.ts`. |
| **`HTTP 500` on newly deployed endpoints or missing column errors** | New application code referencing updated database entities was deployed to production before migrations were applied. | Follow the golden deployment rule: always run `npm run migration:run` against the production database *before* pushing the code. |
| **`HTTP 403: Driver is not enabled to publish departures`** | Prospective drivers registered via `/auth/register/driver` default to `driver_enabled = false` until approved. | Log into the Admin Console (`/app` as `admin@example.com`) and click **Enable**, or send an authenticated `PATCH /admin/drivers/:id/enable` request with `{ "enabled": true }`. |

---

## 11. Known Limitations

1. **Simulated Payment Processing**:  
   MoveMe operates in demonstration mode. Payments are simulated via internal endpoints ([src/routes/payment.routes.ts](file:///c:/Users/HP/Desktop/MOVE%20ME/src/routes/payment.routes.ts)); real-world payment acquiring webhooks (e.g., Paystack, Flutterwave, Stripe) are not integrated.
2. **Remote Database Test Latency**:  
   Because all 228+ integration tests execute against a live cloud-hosted PostgreSQL database in AWS US-East-2 rather than a local mock, the full test run takes approximately 15 minutes.
