import express, { Request, Response } from "express";
import swaggerUi from "swagger-ui-express";

import authRouter from "./routes/auth.routes";
import driverRouter from "./routes/driver.routes";
import adminRouter from "./routes/admin.routes";
import departureRouter from "./routes/departure.routes";
import reservationRouter from "./routes/reservation.routes";
import paymentRouter from "./routes/payment.routes";
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

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

export default app;

