import swaggerJsdoc from "swagger-jsdoc";
import path from "path";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "MoveMe API",
      version: "1.0.0",
      description:
        "OpenAPI documentation for MoveMe ride-pooling platform backend service.",
    },
    servers: [
      {
        url: "/",
        description: "Current environment (auto-detected)",
      },
      {
        url: process.env.RENDER_EXTERNAL_URL || "https://move-me-1nu3.onrender.com",
        description: "Render server (hosted)",
      },
      {
        url: `http://localhost:${process.env.PORT || 3000}`,
        description: "Local development server",
      },
    ],
    tags: [
      {
        name: "Auth",
        description: "Authentication and user registration",
      },
      {
        name: "Vehicles",
        description: "Driver vehicle registration and management",
      },
      {
        name: "Admin",
        description: "Administrative verification and driver onboarding",
      },
      {
        name: "Departures",
        description: "Departure publishing and ride discovery",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Enter your Bearer JWT token",
        },
      },
    },
  },
  apis: [
    path.join(__dirname, "routes", "*.routes.ts").split(path.sep).join("/"),
    path.join(__dirname, "routes", "*.routes.js").split(path.sep).join("/"),
    path.join(__dirname, "*.routes.ts").split(path.sep).join("/"),
    path.join(__dirname, "*.routes.js").split(path.sep).join("/"),
    path.resolve(process.cwd(), "src/routes/*.routes.ts").split(path.sep).join("/"),
    path.resolve(process.cwd(), "dist/routes/*.routes.js").split(path.sep).join("/"),
    "./src/routes/*.routes.ts",
    "./dist/routes/*.routes.js",
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
