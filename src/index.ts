import "reflect-metadata";
import dotenv from "dotenv";
dotenv.config({ quiet: true });

import express, { Request, Response } from "express";
import { AppDataSource } from "./data-source";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

// Start HTTP server and connect to database
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });

  if (process.env.DATABASE_URL) {
    AppDataSource.initialize()
      .then(() => {
        console.log("Data Source has been initialized successfully.");
      })
      .catch((err) => {
        console.error("Error during Data Source initialization:", err);
      });
  } else {
    console.warn("DATABASE_URL is not set. Database not initialized.");
  }
}

export default app;
