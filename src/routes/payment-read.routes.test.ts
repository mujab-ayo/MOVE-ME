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

dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env" });

describe("Payment Read Endpoint Integration (GET /payments/:id)", () => {
  const secret = process.env.JWT_SECRET || "ride_pooling_capstone_dev_secret_key_2026";
  let passengerOwner: User;
  let anotherPassenger: User;
  let departureDriver: User;
  let admin: User;
  let passengerOwnerToken: string;
  let anotherPassengerToken: string;
  let departureDriverToken: string;
  let adminToken: string;
  let testRoute: Route;
  let testVehicle: Vehicle;
  let testDeparture: Departure;
  let testReservation: Reservation;
  let testPayment: Payment;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const userRepo = AppDataSource.getRepository(User);
    const vehicleRepo = AppDataSource.getRepository(Vehicle);
    const routeRepo = AppDataSource.getRepository(Route);
    const departureRepo = AppDataSource.getRepository(Departure);
    const reservationRepo = AppDataSource.getRepository(Reservation);
    const paymentRepo = AppDataSource.getRepository(Payment);

    // Clean up
    await paymentRepo.createQueryBuilder().delete().execute();
    await reservationRepo.createQueryBuilder().delete().execute();
    await departureRepo.createQueryBuilder().delete().execute();
    await vehicleRepo.createQueryBuilder().delete().execute();
    await userRepo.createQueryBuilder().delete().execute();
    await routeRepo.createQueryBuilder().delete().execute();

    passengerOwner = await userRepo.save(
      userRepo.create({
        email: `pay-owner-${Date.now()}@test.com`,
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    anotherPassenger = await userRepo.save(
      userRepo.create({
        email: `pay-other-${Date.now()}@test.com`,
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    departureDriver = await userRepo.save(
      userRepo.create({
        email: `pay-driver-${Date.now()}@test.com`,
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    admin = await userRepo.save(
      userRepo.create({
        email: `pay-admin-${Date.now()}@test.com`,
        password_hash: "hash",
        role: "ADMIN",
        driver_enabled: false,
      })
    );

    passengerOwnerToken = jwt.sign(
      { sub: passengerOwner.id, role: passengerOwner.role },
      secret
    );
    anotherPassengerToken = jwt.sign(
      { sub: anotherPassenger.id, role: anotherPassenger.role },
      secret
    );
    departureDriverToken = jwt.sign(
      { sub: departureDriver.id, role: departureDriver.role },
      secret
    );
    adminToken = jwt.sign({ sub: admin.id, role: admin.role }, secret);

    testRoute = await routeRepo.save(
      routeRepo.create({
        pickup_point: "Payment Read Pickup",
        dropoff_point: "Payment Read Dropoff",
        base_duration_minutes: 30,
        base_fare_solo: "5000.00",
        base_fare_per_seat: "2000.00",
        active: true,
      })
    );

    testVehicle = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: departureDriver.id,
        description: "Payment Read Bus",
        registration_identifier: `PAY-READ-${Date.now()}`,
        seat_capacity: 4,
        active: true,
      })
    );

    testDeparture = await departureRepo.save(
      departureRepo.create({
        driver_id: departureDriver.id,
        vehicle_id: testVehicle.id,
        route_id: testRoute.id,
        departure_time: new Date(Date.now() + 2 * 3600 * 1000),
        duration_minutes: 30,
        fare_amount: "2000.00",
        capacity: 4,
        mode: "POOLED",
        status: "SCHEDULED",
      })
    );

    testReservation = await reservationRepo.save(
      reservationRepo.create({
        departure_id: testDeparture.id,
        passenger_id: passengerOwner.id,
        status: "CONFIRMED",
        fare_amount: "2000.00",
        hold_expires_at: new Date(Date.now() + 15 * 60 * 1000),
      })
    );

    testPayment = await paymentRepo.save(
      paymentRepo.create({
        reservation_id: testReservation.id,
        amount: "2000.00",
        status: "SUCCEEDED",
        idempotency_key: `idemp-key-secret-${Date.now()}`,
        completed_at: new Date(),
        refunded_at: null,
      })
    );
  }, 60000);

  afterAll(async () => {
    const userRepo = AppDataSource.getRepository(User);
    const vehicleRepo = AppDataSource.getRepository(Vehicle);
    const routeRepo = AppDataSource.getRepository(Route);
    const departureRepo = AppDataSource.getRepository(Departure);
    const reservationRepo = AppDataSource.getRepository(Reservation);
    const paymentRepo = AppDataSource.getRepository(Payment);

    await paymentRepo.createQueryBuilder().delete().execute();
    await reservationRepo.createQueryBuilder().delete().execute();
    await departureRepo.createQueryBuilder().delete().execute();
    await vehicleRepo.createQueryBuilder().delete().execute();
    await userRepo.createQueryBuilder().delete().execute();
    await routeRepo.createQueryBuilder().delete().execute();

    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }, 60000);

  it("owner gets 200 with no idempotency_key", async () => {
    const res = await request(app)
      .get(`/payments/${testPayment.id}`)
      .set("Authorization", `Bearer ${passengerOwnerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(testPayment.id);
    expect(res.body.reservation_id).toBe(testReservation.id);
    expect(res.body.amount).toBe(testPayment.amount);
    expect(res.body.status).toBe(testPayment.status);
    expect(res.body.completed_at).toBeDefined();
    expect(res.body.refunded_at).toBeNull();

    // Sensitive field omission checks
    expect(res.body.idempotency_key).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("idempotency_key");
    expect(JSON.stringify(res.body)).not.toContain(testPayment.idempotency_key);

    // Whitelist check: strictly only the required 6 fields
    const keys = Object.keys(res.body).sort();
    expect(keys).toEqual([
      "amount",
      "completed_at",
      "id",
      "refunded_at",
      "reservation_id",
      "status",
    ]);
  });

  it("another passenger 403", async () => {
    const res = await request(app)
      .get(`/payments/${testPayment.id}`)
      .set("Authorization", `Bearer ${anotherPassengerToken}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Forbidden: not your payment" });
  });

  it("a driver (including the departure's own driver) 403", async () => {
    const res = await request(app)
      .get(`/payments/${testPayment.id}`)
      .set("Authorization", `Bearer ${departureDriverToken}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Forbidden: not your payment" });
  });

  it("admin 403", async () => {
    const res = await request(app)
      .get(`/payments/${testPayment.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Forbidden: not your payment" });
  });

  it("no token 401", async () => {
    const res = await request(app).get(`/payments/${testPayment.id}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: "Authentication token missing or invalid",
    });
  });

  it("unknown id 404", async () => {
    const unknownId = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .get(`/payments/${unknownId}`)
      .set("Authorization", `Bearer ${passengerOwnerToken}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Payment not found" });
  });

  it("malformed id 400", async () => {
    const res = await request(app)
      .get("/payments/not-a-valid-uuid")
      .set("Authorization", `Bearer ${passengerOwnerToken}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid payment ID format" });
  });
});
