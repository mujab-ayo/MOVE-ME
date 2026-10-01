import express, { Request, Response } from "express";

import authRouter from "./routes/auth.routes";
import driverRouter from "./routes/driver.routes";
import adminRouter from "./routes/admin.routes";
import departureRouter from "./routes/departure.routes";

const app = express();

app.use(express.json());

// Routes
app.use("/auth", authRouter);
app.use("/drivers", driverRouter);
app.use("/admin", adminRouter);
app.use("/departures", departureRouter);

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

export default app;
