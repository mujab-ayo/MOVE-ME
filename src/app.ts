import express, { Request, Response, NextFunction } from "express";
import path from "path";
import swaggerUi from "swagger-ui-express";

import authRouter from "./routes/auth.routes";
import driverRouter from "./routes/driver.routes";
import adminRouter from "./routes/admin.routes";
import departureRouter from "./routes/departure.routes";
import reservationRouter from "./routes/reservation.routes";
import paymentRouter from "./routes/payment.routes";
import passengerRouter from "./routes/passenger.routes";
import routeRouter from "./routes/route.routes";
import notificationRouter from "./routes/notification.routes";
import { swaggerSpec } from "./swagger";

const app = express();

// Enable CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json());

// Redirect root to Swagger UI documentation
app.get("/", (_req: Request, res: Response) => {
  res.redirect("/docs");
});

// Routes
app.use("/auth", authRouter);
app.use("/drivers", driverRouter);
app.use("/admin", adminRouter);
app.use("/departures", departureRouter);
app.use("/reservations", reservationRouter);
app.use("/payments", paymentRouter);
app.use("/passengers", passengerRouter);
app.use("/routes", routeRouter);
app.use("/notifications", notificationRouter);

// Swagger UI documentation
const swaggerUiOptions = {
  customSiteTitle: "MoveMe API Documentation",
  customCssUrl: "https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui.min.css",
  customJs: [
    "https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui-bundle.js",
    "https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.11.0/swagger-ui-standalone-preset.js",
  ],
  swaggerOptions: {
    docExpansion: "list",
    filter: true,
    persistAuthorization: true,
  },
};

// Serve Swagger assets for both root-relative (/swagger-ui*) and doc-relative (/docs/swagger-ui*) paths
app.use(swaggerUi.serve);
app.get("/docs", swaggerUi.setup(swaggerSpec, swaggerUiOptions));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerUiOptions));

// Optional raw JSON spec endpoint
app.get("/docs.json", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Check service operational health and database readiness (Public).
 *     description: Returns 200 with status ok when the service is healthy.
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *             example:
 *               status: ok
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

// Serve frontend static files
app.use("/app", express.static(path.join(__dirname, "..", "public")));

// 404 handler for unknown routes
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// Final error-handling middleware
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  // Malformed JSON request bodies
  if (
    (err instanceof SyntaxError && ((err as any).status === 400 || (err as any).statusCode === 400)) ||
    err?.type === "entity.parse.failed"
  ) {
    return res.status(400).json({ error: "Malformed JSON body" });
  }

  // Server-side error logging
  console.error(err);

  // Status 500 with no stack trace or SQL text
  return res.status(500).json({ error: "Internal server error" });
});

export default app;

