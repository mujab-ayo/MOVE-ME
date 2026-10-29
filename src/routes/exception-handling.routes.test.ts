import request from "supertest";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import app from "../app";
import { AppDataSource } from "../data-source";
import { User } from "../entities/user.entity";
import { Vehicle } from "../entities/vehicle.entity";
import { Route } from "../entities/route.entity";
import { Departure } from "../entities/departure.entity";
import { Reservation } from "../entities/reservation.entity";
import { Payment } from "../entities/payment.entity";

dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env", quiet: true });

describe("Exception Handling & Data Exposure Integration", () => {
  const secret = process.env.JWT_SECRET || "ride_pooling_capstone_dev_secret_key_2026";
  let driver: User;
  let passenger: User;
  let driverToken: string;
  let passengerToken: string;
  let route: Route;
  let vehicle: Vehicle;
  let departure: Departure;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const userRepo = AppDataSource.getRepository(User);
    const vehicleRepo = AppDataSource.getRepository(Vehicle);
    const routeRepo = AppDataSource.getRepository(Route);
    const departureRepo = AppDataSource.getRepository(Departure);

    driver = await userRepo.save(
      userRepo.create({
        email: `driver-err-${Date.now()}@test.com`,
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    passenger = await userRepo.save(
      userRepo.create({
        email: `passenger-err-${Date.now()}@test.com`,
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    driverToken = jwt.sign({ sub: driver.id, role: driver.role }, secret);
    passengerToken = jwt.sign({ sub: passenger.id, role: passenger.role }, secret);

    route = await routeRepo.save(
      routeRepo.create({
        pickup_point: "Err Pickup",
        dropoff_point: "Err Dropoff",
        base_duration_minutes: 30,
        base_fare_solo: "5000.00",
        base_fare_per_seat: "2000.00",
        active: true,
      })
    );

    vehicle = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: driver.id,
        description: "Err Car",
        registration_identifier: `ERR-${Date.now()}`,
        seat_capacity: 4,
        active: true,
      })
    );

    departure = await departureRepo.save(
      departureRepo.create({
        driver_id: driver.id,
        vehicle_id: vehicle.id,
        route_id: route.id,
        departure_time: new Date(Date.now() + 2 * 60 * 60 * 1000),
        duration_minutes: 30,
        fare_amount: "2000.00",
        capacity: 4,
        mode: "POOLED",
        status: "SCHEDULED",
      })
    );
  });

  describe("1. Unknown Route Handler (JSON 404)", () => {
    it("returns 404 { error: 'Not found' } for unknown GET route", async () => {
      const res = await request(app).get("/unknown-route-12345");
      expect(res.status).toBe(404);
      expect(res.headers["content-type"]).toMatch(/json/);
      expect(res.body).toEqual({ error: "Not found" });
    });

    it("returns 404 { error: 'Not found' } for unknown POST route", async () => {
      const res = await request(app)
        .post("/api/v1/nonexistent")
        .send({ foo: "bar" });
      expect(res.status).toBe(404);
      expect(res.headers["content-type"]).toMatch(/json/);
      expect(res.body).toEqual({ error: "Not found" });
    });
  });

  describe("2. Malformed JSON Request Bodies (JSON 400)", () => {
    it("returns 400 { error: 'Malformed JSON body' } when malformed JSON is sent to POST endpoint", async () => {
      const res = await request(app)
        .post("/auth/login")
        .set("Content-Type", "application/json")
        .send("{ broken json body, not valid");

      expect(res.status).toBe(400);
      expect(res.headers["content-type"]).toMatch(/json/);
      expect(res.body).toEqual({ error: "Malformed JSON body" });
    });

    it("returns 400 { error: 'Malformed JSON body' } when malformed JSON is sent to authenticated POST endpoint", async () => {
      const res = await request(app)
        .post("/departures")
        .set("Authorization", `Bearer ${driverToken}`)
        .set("Content-Type", "application/json")
        .send('{"mode": "SOLO", "routeId": ');

      expect(res.status).toBe(400);
      expect(res.headers["content-type"]).toMatch(/json/);
      expect(res.body).toEqual({ error: "Malformed JSON body" });
    });

    it("returns 400 { error: 'Malformed JSON body' } when malformed JSON is sent to webhook endpoint", async () => {
      const res = await request(app)
        .post("/webhooks/paystack")
        .set("Content-Type", "application/json")
        .send("{ broken json body, not valid");

      expect(res.status).toBe(400);
      expect(res.headers["content-type"]).toMatch(/json/);
      expect(res.body).toEqual({ error: "Malformed JSON body" });
    });
  });

  describe("3. Final Error-Handling Middleware (JSON 500 without stack or SQL text)", () => {
    it("returns 500 { error: 'Internal server error' } with no stack trace or SQL text when a handler throws", async () => {
      const routeRepo = AppDataSource.getRepository(Route);
      const spy = jest
        .spyOn(routeRepo, "find")
        .mockRejectedValueOnce(
          new Error("QueryFailedError: SELECT * FROM secret_credentials WHERE token = 'super-secret'; syntax error")
        );

      // Temporarily suppress console.error to keep server-side log clean in test
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      const res = await request(app)
        .get("/routes")
        .set("Authorization", `Bearer ${passengerToken}`);

      expect(res.status).toBe(500);
      expect(res.headers["content-type"]).toMatch(/json/);
      expect(res.body).toEqual({ error: "Internal server error" });

      // Verify no stack trace or SQL text in body or response text
      expect(res.body.stack).toBeUndefined();
      expect(res.body.sql).toBeUndefined();
      expect(res.body.message).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain("SELECT");
      expect(JSON.stringify(res.body)).not.toContain("secret_credentials");
      expect(JSON.stringify(res.body)).not.toContain("stack");
      expect(res.text).not.toContain("SELECT");
      expect(res.text).not.toContain("secret_credentials");

      // Verify server-side logging occurred
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
      spy.mockRestore();
    });
  });

  describe("4. GET /reservations/:id Data Exposure", () => {
    it("driver's response has no payments and no idempotency_key", async () => {
      const reservationRepo = AppDataSource.getRepository(Reservation);
      const paymentRepo = AppDataSource.getRepository(Payment);

      const reservation = await reservationRepo.save(
        reservationRepo.create({
          departure_id: departure.id,
          passenger_id: passenger.id,
          status: "CONFIRMED",
          fare_amount: "2000.00",
          hold_expires_at: new Date(Date.now() + 10 * 60 * 1000),
        })
      );

      const driverKey = `driver-key-${Date.now()}-${Math.random()}`;
      await paymentRepo.save(
        paymentRepo.create({
          reservation_id: reservation.id,
          amount: "2000.00",
          status: "SUCCEEDED",
          idempotency_key: driverKey,
        })
      );

      const res = await request(app)
        .get(`/reservations/${reservation.id}`)
        .set("Authorization", `Bearer ${driverToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(reservation.id);
      expect(res.body.status).toBe("CONFIRMED");
      // Driver sees no payment records at all
      expect(res.body.payments).toBeUndefined();
      expect(res.body.idempotency_key).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain("payments");
      expect(JSON.stringify(res.body)).not.toContain(driverKey);
      expect(JSON.stringify(res.body)).not.toContain("idempotency_key");
    });

    it("passenger's response has payments without idempotency_key", async () => {
      const userRepo = AppDataSource.getRepository(User);
      const reservationRepo = AppDataSource.getRepository(Reservation);
      const paymentRepo = AppDataSource.getRepository(Payment);

      const passenger2 = await userRepo.save(
        userRepo.create({
          email: `pass2-${Date.now()}-${Math.random()}@test.com`,
          password_hash: "hash",
          role: "PASSENGER",
          driver_enabled: false,
        })
      );
      const passenger2Token = jwt.sign({ sub: passenger2.id, role: passenger2.role }, secret);

      const reservation = await reservationRepo.save(
        reservationRepo.create({
          departure_id: departure.id,
          passenger_id: passenger2.id,
          status: "CONFIRMED",
          fare_amount: "2000.00",
          hold_expires_at: new Date(Date.now() + 10 * 60 * 1000),
        })
      );

      const passengerKey = `pass-key-${Date.now()}-${Math.random()}`;
      const payment = await paymentRepo.save(
        paymentRepo.create({
          reservation_id: reservation.id,
          amount: "2000.00",
          status: "SUCCEEDED",
          idempotency_key: passengerKey,
        })
      );

      const res = await request(app)
        .get(`/reservations/${reservation.id}`)
        .set("Authorization", `Bearer ${passenger2Token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(reservation.id);
      expect(Array.isArray(res.body.payments)).toBe(true);
      expect(res.body.payments).toHaveLength(1);
      expect(res.body.payments[0]).toEqual({
        id: payment.id,
        status: "SUCCEEDED",
        amount: "2000.00",
        refunded_at: null,
      });
      // Never return idempotency_key to anyone
      expect(res.body.payments[0].idempotency_key).toBeUndefined();
      expect(res.body.idempotency_key).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain(passengerKey);
      expect(JSON.stringify(res.body)).not.toContain("idempotency_key");
    });
  });
});
