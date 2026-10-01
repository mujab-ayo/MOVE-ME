import "reflect-metadata";
import dotenv from "dotenv";
dotenv.config({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

import app from "./app";
import { AppDataSource } from "./data-source";

const PORT = process.env.PORT || 3000;

AppDataSource.initialize()
  .then(() => {
    console.log("Data Source has been initialized successfully.");
    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Error during Data Source initialization:", err);
  });
