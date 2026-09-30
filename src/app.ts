import express, { Request, Response } from "express";

import authRouter from "./routes/auth.routes";

const app = express();

app.use(express.json());

// Routes
app.use("/auth", authRouter);

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

export default app;
