import request from "supertest";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import app from "../app";
import { AppDataSource } from "../data-source";
import { User } from "../entities/user.entity";
import { Route } from "../entities/route.entity";
import { Departure } from "../entities/departure.entity";
import { Reservation } from "../entities/reservation.entity";
import { Payment } from "../entities/payment.entity";
import { Vehicle } from "../entities/vehicle.entity";

dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env" });

describe("Route Endpoints Integration (GET /routes)", () => {
  const secret = process.env.JWT_SECRET || "ride_pooling_capstone_dev_secret_key_2026";
  let passenger: User;
  let driver: User;
  let passengerToken: string;
  let driverToken: string;
  let activeRoute1: Route;
  let activeRoute2: Route;
  let inactiveRoute: Route;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const paymentRepo = AppDataSource.getRepository(Payment);
    const reservationRepo = AppDataSource.getRepository(Reservation);
    const departureRepo = AppDataSource.getRepository(Departure);
    const vehicleRepo = AppDataSource.getRepository(Vehicle);
    const userRepo = AppDataSource.getRepository(User);
    const routeRepo = AppDataSource.getRepository(Route);

    // Clean up
    await paymentRepo.createQueryBuilder().delete().execute();
    await reservationRepo.createQueryBuilder().delete().execute();
    await departureRepo.createQueryBuilder().delete().execute();
    await vehicleRepo.createQueryBuilder().delete().execute();
    await userRepo.createQueryBuilder().delete().execute();
    await routeRepo.createQueryBuilder().delete().execute();

    passenger = await userRepo.save(
      userRepo.create({
        email: "routes_passenger@test.com",
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    driver = await userRepo.save(
      userRepo.create({
        email: "routes_driver@test.com",
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    passengerToken = jwt.sign({ sub: passenger.id, role: passenger.role }, secret);
    driverToken = jwt.sign({ sub: driver.id, role: driver.role }, secret);

    // Seed routes: activeRoute2 has pickup starting with 'B', activeRoute1 starting with 'A'
    activeRoute2 = await routeRepo.save(
      routeRepo.create({
        pickup_point: "B Marina Bus Terminal, Lagos Island",
        dropoff_point: "Victoria Island Financial District, Lagos",
        base_duration_minutes: 30,
        base_fare_solo: "5000.00",
        base_fare_per_seat: "1800.00",
        active: true,
      })
    );

    activeRoute1 = await routeRepo.save(
      routeRepo.create({
        pickup_point: "A Ikeja City Mall, Alausa, Ikeja",
        dropoff_point: "Victoria Island Financial District, Lagos",
        base_duration_minutes: 45,
        base_fare_solo: "7500.00",
        base_fare_per_seat: "2500.00",
        active: true,
      })
    );

    inactiveRoute = await routeRepo.save(
      routeRepo.create({
        pickup_point: "Archived Old Terminal, Yaba",
        dropoff_point: "Lekki Toll Gate",
        base_duration_minutes: 50,
        base_fare_solo: "6000.00",
        base_fare_per_seat: "2000.00",
        active: false,
      })
    );
  }, 30000);

  afterAll(async () => {
    const paymentRepo = AppDataSource.getRepository(Payment);
    const reservationRepo = AppDataSource.getRepository(Reservation);
    const departureRepo = AppDataSource.getRepository(Departure);
    const vehicleRepo = AppDataSource.getRepository(Vehicle);
    const userRepo = AppDataSource.getRepository(User);
    const routeRepo = AppDataSource.getRepository(Route);

    await paymentRepo.createQueryBuilder().delete().execute();
    await reservationRepo.createQueryBuilder().delete().execute();
    await departureRepo.createQueryBuilder().delete().execute();
    await vehicleRepo.createQueryBuilder().delete().execute();
    await userRepo.createQueryBuilder().delete().execute();
    await routeRepo.createQueryBuilder().delete().execute();

    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }, 30000);

  describe("GET /routes", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app).get("/routes");

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: "Authentication token missing or invalid",
      });
    });

    it("returns 200 for a passenger", async () => {
      const res = await request(app)
        .get("/routes")
        .set("Authorization", `Bearer ${passengerToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });

    it("returns 200 for a driver", async () => {
      const res = await request(app)
        .get("/routes")
        .set("Authorization", `Bearer ${driverToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });

    it("excludes inactive routes and orders active routes by pickup_point", async () => {
      const res = await request(app)
        .get("/routes")
        .set("Authorization", `Bearer ${passengerToken}`);

      expect(res.status).toBe(200);
      const returnedIds = res.body.map((r: any) => r.id);

      // Inactive route is excluded
      expect(returnedIds).not.toContain(inactiveRoute.id);
      expect(returnedIds).toContain(activeRoute1.id);
      expect(returnedIds).toContain(activeRoute2.id);

      // Ordered by pickup_point ascending
      expect(res.body[0].id).toBe(activeRoute1.id);
      expect(res.body[0].pickup_point).toBe("A Ikeja City Mall, Alausa, Ikeja");
      expect(res.body[1].id).toBe(activeRoute2.id);
      expect(res.body[1].pickup_point).toBe("B Marina Bus Terminal, Lagos Island");
    });

    it("returns each route with exactly the required fields", async () => {
      const res = await request(app)
        .get("/routes")
        .set("Authorization", `Bearer ${passengerToken}`);

      expect(res.status).toBe(200);
      const firstRoute = res.body[0];

      expect(firstRoute).toEqual({
        id: activeRoute1.id,
        pickup_point: activeRoute1.pickup_point,
        dropoff_point: activeRoute1.dropoff_point,
        base_duration_minutes: activeRoute1.base_duration_minutes,
        base_fare_solo: activeRoute1.base_fare_solo,
        base_fare_per_seat: activeRoute1.base_fare_per_seat,
      });

      // active column should not be leaked in the response object
      expect(firstRoute.active).toBeUndefined();
    });

    it("documents GET /routes in Swagger under the Departures tag", async () => {
      const res = await request(app).get("/docs.json");

      expect(res.status).toBe(200);
      expect(res.body.paths["/routes"]).toBeDefined();
      expect(res.body.paths["/routes"].get).toBeDefined();
      expect(res.body.paths["/routes"].get.tags).toContain("Departures");
    });
  });
});
