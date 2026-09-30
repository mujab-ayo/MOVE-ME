import "reflect-metadata";
import { DataSource } from "typeorm";
import dotenv from "dotenv";
import path from "path";
import { User } from "./entities/user.entity";
import { CreateUsersTable1711800000000 } from "./migrations/1711800000000-CreateUsersTable";

dotenv.config({ quiet: true });

const isSsl = process.env.DATABASE_URL?.includes("sslmode=require");

export const AppDataSource = new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL,
  ssl: isSsl ? { rejectUnauthorized: false } : false,
  synchronize: false,
  logging: process.env.NODE_ENV === "development",
  entities: [User, path.join(__dirname, "entities/**/*.{ts,js}")],
  migrations: [CreateUsersTable1711800000000, path.join(__dirname, "migrations/**/*.{ts,js}")],
  subscribers: [],
});
