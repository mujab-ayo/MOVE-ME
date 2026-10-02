import express, { Request, Response } from "express";
import swaggerUi from "swagger-ui-express";

import authRouter from "./routes/auth.routes";
import driverRouter from "./routes/driver.routes";
import adminRouter from "./routes/admin.routes";
import departureRouter from "./routes/departure.routes";
import { swaggerSpec } from "./swagger";

const app = express();

app.use(express.json());

// Routes
app.use("/auth", authRouter);
app.use("/drivers", driverRouter);
app.use("/admin", adminRouter);
app.use("/departures", departureRouter);

// Swagger UI documentation
const swaggerUiOptions = {
  customSiteTitle: "MoveMe API Documentation",
  swaggerOptions: {
    docExpansion: "list",
    filter: true,
    persistAuthorization: true,
  },
};

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

