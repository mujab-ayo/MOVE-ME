import "reflect-metadata";
import { DataSource } from "typeorm";
import dotenv from "dotenv";
import path from "path";
import { User } from "./entities/user.entity";
import { Vehicle } from "./entities/vehicle.entity";
import { Route } from "./entities/route.entity";
import { Departure } from "./entities/departure.entity";
import { Reservation } from "./entities/reservation.entity";
import { Payment } from "./entities/payment.entity";
import { Notification } from "./entities/notification.entity";

dotenv.config({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env', quiet: true });

const isSsl = process.env.DATABASE_URL?.includes("sslmode=require");

export const AppDataSource = new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL,
  ssl: isSsl ? { rejectUnauthorized: false } : false,
  synchronize: false,
  logging: process.env.NODE_ENV === "development",
  entities: [User, Vehicle, Route, Departure, Reservation, Payment, Notification],
  migrations: [path.join(__dirname, "migrations/**/*.{ts,js}")],
  subscribers: [],
  extra: {
    max: process.env.NODE_ENV === "test" ? 20 : 10,
  },
});
