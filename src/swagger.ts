import swaggerJsdoc from "swagger-jsdoc";
import path from "path";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "MoveMe API",
      version: "1.0.0",
      description: `MoveMe ride-pooling platform backend service.

### How to Authenticate
1. **Register**: Call \`POST /auth/register/passenger\` or \`POST /auth/register/driver\` to create an account.
2. **Log In**: Call \`POST /auth/login\` with your registered email and password.
3. **Copy Token**: Copy the \`accessToken\` string from the 200 response body.
4. **Click Authorize**: Click the **Authorize** button (lock icon) at the top right of this page.
5. **Paste Token**: Paste the token into the Value field and click **Authorize**.

### User Roles & Capabilities
- **PASSENGER**: Can search upcoming departures, view active routes, reserve seats, initiate payments, cancel reservations, view personal reservation and payment histories, and read in-app notifications.
- **DRIVER**: Can register vehicles, publish solo and pooled departures once verified by admin, view active routes, advance departure trip lifecycle (/arrive, /depart, /complete), cancel departures, and view passengers booked on their departures.
- **ADMIN**: Can review unverified driver registrations and enable or disable driver publishing privileges.`,
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Local development server",
      },
      {
        url: process.env.RENDER_EXTERNAL_URL || "https://move-me-1nu3.onrender.com",
        description: "Production Render server",
      },
    ],
    tags: [
      {
        name: "Auth",
        description: "User registration and JWT credential authentication (Public).",
      },
      {
        name: "Vehicles",
        description: "Vehicle fleet registration and driver vehicle management (Driver).",
      },
      {
        name: "Admin",
        description: "Administrative driver verification and onboarding management (Admin).",
      },
      {
        name: "Departures",
        description: "Departure publishing, trip lifecycle milestones, and route discovery (Driver, Passenger).",
      },
      {
        name: "Bookings",
        description: "Passenger seat reservations, booking cancellations, and notifications (Passenger, Driver).",
      },
      {
        name: "Payments",
        description: "Payment authorization, status tracking, and PSP settlement callbacks (Passenger, Public).",
      },
      {
        name: "Health",
        description: "Operational health and service availability monitoring (Public).",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Enter your Bearer JWT token (without 'Bearer ' prefix)",
        },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "string",
              description: "Descriptive error message explaining the failure reason.",
              example: "Descriptive error message",
            },
          },
        },
      },
    },
  },
  apis: [
    path.join(__dirname, "routes", "*.routes.ts").split(path.sep).join("/"),
    path.join(__dirname, "routes", "*.routes.js").split(path.sep).join("/"),
    path.join(__dirname, "*.routes.ts").split(path.sep).join("/"),
    path.join(__dirname, "*.routes.js").split(path.sep).join("/"),
    path.join(__dirname, "app.ts").split(path.sep).join("/"),
    path.join(__dirname, "app.js").split(path.sep).join("/"),
    path.resolve(process.cwd(), "src/routes/*.routes.ts").split(path.sep).join("/"),
    path.resolve(process.cwd(), "dist/routes/*.routes.js").split(path.sep).join("/"),
    path.resolve(process.cwd(), "src/app.ts").split(path.sep).join("/"),
    path.resolve(process.cwd(), "dist/app.js").split(path.sep).join("/"),
    "./src/routes/*.routes.ts",
    "./dist/routes/*.routes.js",
    "./src/app.ts",
    "./dist/app.js",
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
