import request from "supertest";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import crypto from "crypto";
import app from "../app";
import { AppDataSource } from "../data-source";
import { User } from "../entities/user.entity";
import { Vehicle } from "../entities/vehicle.entity";
import { Route } from "../entities/route.entity";
import { Departure } from "../entities/departure.entity";
import { Reservation } from "../entities/reservation.entity";
import { Payment } from "../entities/payment.entity";

dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env" });

describe("Booking Race and Reservation Invariants (MM-04 & MM-05)", () => {
  const secret = process.env.JWT_SECRET || "ride_pooling_capstone_dev_secret_key_2026";
  let driver: User;
  let passengers: User[] = [];
  let passengerTokens: string[] = [];
  let testRoute: Route;
  let soloVehicle: Vehicle;
  let pooledVehicle: Vehicle;

  // Warm the connection pool by acquiring and immediately releasing N connections
  const warmPool = async (size = 20) => {
    const runners = await Promise.all(
      Array.from({ length: size }, async () => {
        const qr = AppDataSource.createQueryRunner();
        await qr.connect();
        return qr;
      })
    );
    await Promise.all(runners.map((qr) => qr.release()));
  };

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    // Warm connection pool up to 20 connections
    await warmPool(20);

    const paymentRepo = AppDataSource.getRepository(Payment);
    const reservationRepo = AppDataSource.getRepository(Reservation);
    const departureRepo = AppDataSource.getRepository(Departure);
    const vehicleRepo = AppDataSource.getRepository(Vehicle);
    const userRepo = AppDataSource.getRepository(User);
    const routeRepo = AppDataSource.getRepository(Route);

    // Clean up all related tables
    await paymentRepo.createQueryBuilder().delete().execute();
    await reservationRepo.createQueryBuilder().delete().execute();
    await departureRepo.createQueryBuilder().delete().execute();
    await vehicleRepo.createQueryBuilder().delete().execute();
    await userRepo.createQueryBuilder().delete().execute();
    await routeRepo.createQueryBuilder().delete().execute();

    // Create test driver
    driver = await userRepo.save(
      userRepo.create({
        email: "race_driver@test.com",
        password_hash: "dummy_hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    // Create solo vehicle (seat_capacity: 1)
    soloVehicle = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: driver.id,
        registration_identifier: "RACE-SOLO-01",
        seat_capacity: 1,
        description: "Solo Coupe 1 Seat",
      })
    );

    // Create pooled vehicle (seat_capacity: 3)
    pooledVehicle = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: driver.id,
        registration_identifier: "RACE-POOL-03",
        seat_capacity: 3,
        description: "Pooled Sedan 3 Seats",
      })
    );

    // Create test route
    testRoute = await routeRepo.save(
      routeRepo.create({
        pickup_point: "Ikeja Terminal, Lagos",
        dropoff_point: "Victoria Island, Lagos",
        base_duration_minutes: 45,
        base_fare_solo: "6000.00",
        base_fare_per_seat: "2000.00",
        active: true,
      })
    );

    // Create 10 test passengers directly with repo (fast setup without argon2 overhead)
    const passengerEntities = Array.from({ length: 10 }, (_, i) =>
      userRepo.create({
        email: `race_passenger_${i}@test.com`,
        password_hash: "dummy_hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );
    passengers = await userRepo.save(passengerEntities);

    // Sign JWTs directly with jwt.sign
    passengerTokens = passengers.map((p) =>
      jwt.sign({ sub: p.id, role: p.role }, secret)
    );
  });

  describe("Concurrent booking races (MM-04 & MM-05)", () => {
    it("Test 1: SOLO departure (capacity 1), 10 different passengers, 10 concurrent requests -> exactly 1 success (201) and 9 conflicts (409), exactly 1 active row", async () => {
      const departureRepo = AppDataSource.getRepository(Departure);
      const reservationRepo = AppDataSource.getRepository(Reservation);

      // Create SOLO departure (capacity 1)
      const soloDeparture = await departureRepo.save(
        departureRepo.create({
          driver_id: driver.id,
          vehicle_id: soloVehicle.id,
          route_id: testRoute.id,
          mode: "SOLO",
          departure_time: new Date(Date.now() + 24 * 3600 * 1000), // tomorrow
          duration_minutes: 45,
          fare_amount: "6000.00",
          capacity: 1,
          status: "SCHEDULED",
        })
      );

      // Warm pool before concurrent burst
      await warmPool(20);

      // 10 concurrent POST /departures/:id/reservations via Promise.all
      const responses = await Promise.all(
        passengerTokens.map((token) =>
          request(app)
            .post(`/departures/${soloDeparture.id}/reservations`)
            .set("Authorization", `Bearer ${token}`)
        )
      );

      const successes = responses.filter((r) => r.status === 201);
      const conflicts = responses.filter((r) => r.status === 409);

      // Assert exactly one 201 and nine 409
      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(9);

      for (const conflict of conflicts) {
        expect(conflict.body.error).toBe("No available capacity on this departure");
      }

      // Assert querying reservations directly shows exactly one active row
      const dbReservations = await reservationRepo.find({
        where: { departure_id: soloDeparture.id },
      });
      const activeRows = dbReservations.filter(
        (r) =>
          r.status === "CONFIRMED" ||
          (r.status === "PENDING_PAYMENT" && new Date(r.hold_expires_at) > new Date())
      );
      expect(activeRows).toHaveLength(1);
      expect(dbReservations).toHaveLength(1);
      expect(dbReservations[0].status).toBe("PENDING_PAYMENT");
      expect(dbReservations[0].fare_amount).toBe("6000.00");
    });

    it("Test 2: POOLED departure (capacity 3), same 10 passengers, 10 concurrent requests -> exactly 3 succeed (201) and 7 rejected (409), exactly 3 active rows", async () => {
      const departureRepo = AppDataSource.getRepository(Departure);
      const reservationRepo = AppDataSource.getRepository(Reservation);

      // Create POOLED departure (capacity 3)
      const pooledDeparture = await departureRepo.save(
        departureRepo.create({
          driver_id: driver.id,
          vehicle_id: pooledVehicle.id,
          route_id: testRoute.id,
          mode: "POOLED",
          departure_time: new Date(Date.now() + 48 * 3600 * 1000), // 2 days later
          duration_minutes: 45,
          fare_amount: "2000.00",
          capacity: 3,
          status: "SCHEDULED",
        })
      );

      // Warm pool before concurrent burst
      await warmPool(20);

      // 10 concurrent POST /departures/:id/reservations via Promise.all
      const responses = await Promise.all(
        passengerTokens.map((token) =>
          request(app)
            .post(`/departures/${pooledDeparture.id}/reservations`)
            .set("Authorization", `Bearer ${token}`)
        )
      );

      const successes = responses.filter((r) => r.status === 201);
      const conflicts = responses.filter((r) => r.status === 409);

      // Assert exactly 3 succeed and 7 are rejected
      expect(successes).toHaveLength(3);
      expect(conflicts).toHaveLength(7);

      for (const conflict of conflicts) {
        expect(conflict.body.error).toBe("No available capacity on this departure");
      }

      // Assert exactly 3 active rows in the database
      const dbReservations = await reservationRepo.find({
        where: { departure_id: pooledDeparture.id },
      });
      const activeRows = dbReservations.filter(
        (r) =>
          r.status === "CONFIRMED" ||
          (r.status === "PENDING_PAYMENT" && new Date(r.hold_expires_at) > new Date())
      );
      expect(activeRows).toHaveLength(3);
      expect(dbReservations).toHaveLength(3);
      for (const r of dbReservations) {
        expect(r.status).toBe("PENDING_PAYMENT");
        expect(r.fare_amount).toBe("2000.00");
      }
    });

    it("Test 3: One passenger firing 2 concurrent bookings on the same departure (capacity >= 2) -> at most one succeeds, other gets 409 (unique index backstop)", async () => {
      const departureRepo = AppDataSource.getRepository(Departure);
      const reservationRepo = AppDataSource.getRepository(Reservation);

      // Create departure with capacity 3 (>= 2)
      const departure = await departureRepo.save(
        departureRepo.create({
          driver_id: driver.id,
          vehicle_id: pooledVehicle.id,
          route_id: testRoute.id,
          mode: "POOLED",
          departure_time: new Date(Date.now() + 72 * 3600 * 1000), // 3 days later
          duration_minutes: 45,
          fare_amount: "2000.00",
          capacity: 3,
          status: "SCHEDULED",
        })
      );

      await warmPool(5);

      // Same passenger firing 2 concurrent requests
      const responses = await Promise.all([
        request(app)
          .post(`/departures/${departure.id}/reservations`)
          .set("Authorization", `Bearer ${passengerTokens[0]}`),
        request(app)
          .post(`/departures/${departure.id}/reservations`)
          .set("Authorization", `Bearer ${passengerTokens[0]}`),
      ]);

      const successes = responses.filter((r) => r.status === 201);
      const conflicts = responses.filter((r) => r.status === 409);

      // Assert at most one succeeds, the other gets 409
      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].body.error).toBe(
        "Passenger already has an active reservation for this departure"
      );

      // Database check: exactly 1 active reservation row for this passenger
      const dbReservations = await reservationRepo.find({
        where: {
          departure_id: departure.id,
          passenger_id: passengers[0].id,
        },
      });
      expect(dbReservations).toHaveLength(1);
      expect(dbReservations[0].status).toBe("PENDING_PAYMENT");
    });
  });

  describe("Plain cases and eligibility gates", () => {
    it("returns 400 for malformed departure id on reservations", async () => {
      const res = await request(app)
        .post("/departures/not-a-valid-uuid/reservations")
        .set("Authorization", `Bearer ${passengerTokens[0]}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid departure ID format");
    });

    it("Test 4a: unknown departure id returns 404", async () => {
      const nonExistentId = crypto.randomUUID();
      const res = await request(app)
        .post(`/departures/${nonExistentId}/reservations`)
        .set("Authorization", `Bearer ${passengerTokens[0]}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Departure not found");
    });

    it("Test 4b: departure that is not SCHEDULED or is past its departure_time returns 409", async () => {
      const departureRepo = AppDataSource.getRepository(Departure);

      // Subcase 1: departure status is not SCHEDULED (e.g. COMPLETED)
      const completedDeparture = await departureRepo.save(
        departureRepo.create({
          driver_id: driver.id,
          vehicle_id: pooledVehicle.id,
          route_id: testRoute.id,
          mode: "POOLED",
          departure_time: new Date(Date.now() + 96 * 3600 * 1000),
          duration_minutes: 45,
          fare_amount: "2000.00",
          capacity: 3,
          status: "COMPLETED",
        })
      );

      const resCompleted = await request(app)
        .post(`/departures/${completedDeparture.id}/reservations`)
        .set("Authorization", `Bearer ${passengerTokens[0]}`);

      expect(resCompleted.status).toBe(409);
      expect(resCompleted.body.error).toBe("Departure is not eligible for reservations");

      // Subcase 2: departure is SCHEDULED but past its departure_time
      const pastDeparture = await departureRepo.save(
        departureRepo.create({
          driver_id: driver.id,
          vehicle_id: pooledVehicle.id,
          route_id: testRoute.id,
          mode: "POOLED",
          departure_time: new Date(Date.now() - 3600 * 1000), // 1 hour ago
          duration_minutes: 45,
          fare_amount: "2000.00",
          capacity: 3,
          status: "SCHEDULED",
        })
      );

      const resPast = await request(app)
        .post(`/departures/${pastDeparture.id}/reservations`)
        .set("Authorization", `Bearer ${passengerTokens[0]}`);

      expect(resPast.status).toBe(409);
      expect(resPast.body.error).toBe("Departure is not eligible for reservations");
    });

    it("Test 4c: every reservation on a pooled departure has fare_amount equal to departure's fare_amount regardless of join order", async () => {
      const departureRepo = AppDataSource.getRepository(Departure);
      const reservationRepo = AppDataSource.getRepository(Reservation);

      const departureFare = "2500.00";
      const pooledDeparture = await departureRepo.save(
        departureRepo.create({
          driver_id: driver.id,
          vehicle_id: pooledVehicle.id,
          route_id: testRoute.id,
          mode: "POOLED",
          departure_time: new Date(Date.now() + 120 * 3600 * 1000), // 5 days later
          duration_minutes: 45,
          fare_amount: departureFare,
          capacity: 3,
          status: "SCHEDULED",
        })
      );

      // Join 1st seat
      const res1 = await request(app)
        .post(`/departures/${pooledDeparture.id}/reservations`)
        .set("Authorization", `Bearer ${passengerTokens[0]}`);
      expect(res1.status).toBe(201);
      expect(res1.body.fareAmount).toBe(departureFare);

      // Join 2nd seat
      const res2 = await request(app)
        .post(`/departures/${pooledDeparture.id}/reservations`)
        .set("Authorization", `Bearer ${passengerTokens[1]}`);
      expect(res2.status).toBe(201);
      expect(res2.body.fareAmount).toBe(departureFare);

      // Join 3rd seat
      const res3 = await request(app)
        .post(`/departures/${pooledDeparture.id}/reservations`)
        .set("Authorization", `Bearer ${passengerTokens[2]}`);
      expect(res3.status).toBe(201);
      expect(res3.body.fareAmount).toBe(departureFare);

      // Verify all database rows have the exact same fare_amount matching the departure snapshot
      const dbReservations = await reservationRepo.find({
        where: { departure_id: pooledDeparture.id },
        order: { created_at: "ASC" },
      });

      expect(dbReservations).toHaveLength(3);
      for (const row of dbReservations) {
        expect(row.fare_amount).toBe(departureFare);
        expect(row.fare_amount).toBe(pooledDeparture.fare_amount);
      }
    });
  });
});
