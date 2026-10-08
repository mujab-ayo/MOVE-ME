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

describe("Payment Flow Integration (MM-06 / Decision 6)", () => {
  const secret = process.env.JWT_SECRET || "ride_pooling_capstone_dev_secret_key_2026";
  let driver: User;
  let passengerA: User;
  let passengerB: User;
  let driverToken: string;
  let passengerAToken: string;
  let passengerBToken: string;
  let testRoute: Route;
  let testVehicle: Vehicle;
  let testDeparture: Departure;

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

    // Clean up all related tables
    await paymentRepo.createQueryBuilder().delete().execute();
    await reservationRepo.createQueryBuilder().delete().execute();
    await departureRepo.createQueryBuilder().delete().execute();
    await vehicleRepo.createQueryBuilder().delete().execute();
    await userRepo.createQueryBuilder().delete().execute();
    await routeRepo.createQueryBuilder().delete().execute();

    driver = await userRepo.save(
      userRepo.create({
        email: "pay_driver@test.com",
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    passengerA = await userRepo.save(
      userRepo.create({
        email: "pay_passenger_a@test.com",
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    passengerB = await userRepo.save(
      userRepo.create({
        email: "pay_passenger_b@test.com",
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    driverToken = jwt.sign({ sub: driver.id, role: driver.role }, secret);
    passengerAToken = jwt.sign({ sub: passengerA.id, role: passengerA.role }, secret);
    passengerBToken = jwt.sign({ sub: passengerB.id, role: passengerB.role }, secret);

    testRoute = await routeRepo.save(
      routeRepo.create({
        pickup_point: "Ikeja City Mall, Alausa, Ikeja",
        dropoff_point: "Victoria Island Financial District, Lagos",
        base_duration_minutes: 45,
        base_fare_solo: "8000.00",
        base_fare_per_seat: "3000.00",
        active: true,
      })
    );

    testVehicle = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: driver.id,
        description: "Toyota Sienna",
        registration_identifier: "PAY-VEH-101",
        seat_capacity: 4,
        active: true,
      })
    );

    const futureTime = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
    testDeparture = await departureRepo.save(
      departureRepo.create({
        driver_id: driver.id,
        vehicle_id: testVehicle.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: futureTime,
        duration_minutes: 45,
        fare_amount: "3000.00",
        capacity: 4,
        status: "SCHEDULED",
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

  beforeEach(async () => {
    const paymentRepo = AppDataSource.getRepository(Payment);
    const reservationRepo = AppDataSource.getRepository(Reservation);

    await paymentRepo.createQueryBuilder().delete().execute();
    await reservationRepo.createQueryBuilder().delete().execute();
  });

  describe("POST /reservations/:id/payments", () => {
    it("rejects unauthenticated requests with 401", async () => {
      const res = await request(app).post(`/reservations/${crypto.randomUUID()}/payments`);
      expect(res.status).toBe(401);
    });

    it("rejects non-PASSENGER roles with 403", async () => {
      const res = await request(app)
        .post(`/reservations/${crypto.randomUUID()}/payments`)
        .set("Authorization", `Bearer ${driverToken}`);
      expect(res.status).toBe(403);
    });

    it("rejects invalid reservation ID format with 400", async () => {
      const res = await request(app)
        .post("/reservations/invalid-uuid/payments")
        .set("Authorization", `Bearer ${passengerAToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid reservation ID format");
    });

    it("returns 404 when reservation does not exist", async () => {
      const nonExistentId = "00000000-0000-0000-0000-000000000000";
      const res = await request(app)
        .post(`/reservations/${nonExistentId}/payments`)
        .set("Authorization", `Bearer ${passengerAToken}`);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Reservation not found");
    });

    it("rejects 403 when authenticated passenger is not the reservation's owner", async () => {
      const reservationRepo = AppDataSource.getRepository(Reservation);
      const reservation = await reservationRepo.save(
        reservationRepo.create({
          departure_id: testDeparture.id,
          passenger_id: passengerA.id,
          status: "PENDING_PAYMENT",
          fare_amount: "3000.00",
          hold_expires_at: new Date(Date.now() + 5 * 60 * 1000),
        })
      );

      // Passenger B tries to pay for Passenger A's reservation
      const res = await request(app)
        .post(`/reservations/${reservation.id}/payments`)
        .set("Authorization", `Bearer ${passengerBToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Forbidden: not your reservation");
    });

    it("rejects 409 if reservation is not PENDING_PAYMENT (e.g. CONFIRMED)", async () => {
      const reservationRepo = AppDataSource.getRepository(Reservation);
      const reservation = await reservationRepo.save(
        reservationRepo.create({
          departure_id: testDeparture.id,
          passenger_id: passengerA.id,
          status: "CONFIRMED",
          fare_amount: "3000.00",
          hold_expires_at: new Date(Date.now() + 5 * 60 * 1000),
        })
      );

      const res = await request(app)
        .post(`/reservations/${reservation.id}/payments`)
        .set("Authorization", `Bearer ${passengerAToken}`);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Reservation is no longer pending payment or hold has expired");
    });

    it("rejects 409 if hold_expires_at has already passed and flips reservation to EXPIRED", async () => {
      const reservationRepo = AppDataSource.getRepository(Reservation);
      // Create a reservation whose hold expired 30 seconds ago
      const expiredHold = new Date(Date.now() - 30 * 1000);
      const reservation = await reservationRepo.save(
        reservationRepo.create({
          departure_id: testDeparture.id,
          passenger_id: passengerA.id,
          status: "PENDING_PAYMENT",
          fare_amount: "3000.00",
          hold_expires_at: expiredHold,
        })
      );

      const res = await request(app)
        .post(`/reservations/${reservation.id}/payments`)
        .set("Authorization", `Bearer ${passengerAToken}`);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Reservation is no longer pending payment or hold has expired");

      // Verify opportunistic flip to EXPIRED in database (Decision 6b)
      const updated = await reservationRepo.findOne({ where: { id: reservation.id } });
      expect(updated?.status).toBe("EXPIRED");
    });

    it("creates a payment row with status PENDING, fare amount, idempotency key and returns 201", async () => {
      const reservationRepo = AppDataSource.getRepository(Reservation);
      const reservation = await reservationRepo.save(
        reservationRepo.create({
          departure_id: testDeparture.id,
          passenger_id: passengerA.id,
          status: "PENDING_PAYMENT",
          fare_amount: "3000.00",
          hold_expires_at: new Date(Date.now() + 5 * 60 * 1000),
        })
      );

      const res = await request(app)
        .post(`/reservations/${reservation.id}/payments`)
        .set("Authorization", `Bearer ${passengerAToken}`);

      expect(res.status).toBe(201);
      expect(res.body.paymentId).toBeDefined();
      expect(res.body.status).toBe("PENDING");

      // Verify row in DB
      const paymentRepo = AppDataSource.getRepository(Payment);
      const payment = await paymentRepo.findOne({ where: { id: res.body.paymentId } });
      expect(payment).toBeDefined();
      expect(payment?.status).toBe("PENDING");
      expect(Number(payment?.amount)).toBe(3000);
      expect(payment?.reservation_id).toBe(reservation.id);
      expect(payment?.idempotency_key).toBeDefined();
    });
  });

  describe("POST /payments/:id/callback", () => {
    it("rejects invalid payment ID format with 400", async () => {
      const res = await request(app)
        .post("/payments/invalid-uuid/callback")
        .send({ outcome: "SUCCESS" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid payment ID format");
    });

    it("rejects invalid outcome value with 400", async () => {
      const res = await request(app)
        .post(`/payments/${crypto.randomUUID()}/callback`)
        .send({ outcome: "MAYBE" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("outcome must be 'SUCCESS' or 'FAILURE'");
    });

    it("returns 404 when payment does not exist", async () => {
      const nonExistentId = "00000000-0000-0000-0000-000000000000";
      const res = await request(app)
        .post(`/payments/${nonExistentId}/callback`)
        .send({ outcome: "SUCCESS" });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Payment not found");
    });

    describe("Critical MM-06 acceptance scenario: Late callback on expired reservation", () => {
      it("treats late success callback as a no-op, marks payment EXPIRED, does NOT confirm reservation", async () => {
        const reservationRepo = AppDataSource.getRepository(Reservation);
        const paymentRepo = AppDataSource.getRepository(Payment);

        // 1. Create reservation that expired in the past
        const reservation = await reservationRepo.save(
          reservationRepo.create({
            departure_id: testDeparture.id,
            passenger_id: passengerA.id,
            status: "PENDING_PAYMENT",
            fare_amount: "3000.00",
            hold_expires_at: new Date(Date.now() - 60 * 1000), // expired 1 minute ago
          })
        );

        // 2. Create pending payment
        const payment = await paymentRepo.save(
          paymentRepo.create({
            reservation_id: reservation.id,
            amount: "3000.00",
            status: "PENDING",
            idempotency_key: crypto.randomUUID(),
          })
        );

        // 3. Provider sends late callback with outcome SUCCESS
        const res = await request(app)
          .post(`/payments/${payment.id}/callback`)
          .send({ outcome: "SUCCESS" });

        // 4. Assert: Returns 200 indicating it was ignored (no-op, not a 500 error)
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("IGNORED");
        expect(res.body.paymentStatus).toBe("EXPIRED");

        // 5. Assert database state:
        // Payment is marked EXPIRED, NOT SUCCEEDED
        const dbPayment = await paymentRepo.findOne({ where: { id: payment.id } });
        expect(dbPayment?.status).toBe("EXPIRED");

        // Reservation is marked EXPIRED, NOT CONFIRMED
        const dbReservation = await reservationRepo.findOne({ where: { id: reservation.id } });
        expect(dbReservation?.status).toBe("EXPIRED");

        // Verify zero SUCCEEDED payments exist
        const succeededCount = await paymentRepo.count({ where: { status: "SUCCEEDED" } });
        expect(succeededCount).toBe(0);

        // Verify zero CONFIRMED reservations exist
        const confirmedCount = await reservationRepo.count({ where: { status: "CONFIRMED" } });
        expect(confirmedCount).toBe(0);
      });
    });

    describe("Standard SUCCESS outcome", () => {
      it("updates payment to SUCCEEDED and reservation to CONFIRMED when hold is still valid", async () => {
        const reservationRepo = AppDataSource.getRepository(Reservation);
        const paymentRepo = AppDataSource.getRepository(Payment);

        // 1. Create valid pending reservation (hold valid for next 5 mins)
        const reservation = await reservationRepo.save(
          reservationRepo.create({
            departure_id: testDeparture.id,
            passenger_id: passengerA.id,
            status: "PENDING_PAYMENT",
            fare_amount: "3000.00",
            hold_expires_at: new Date(Date.now() + 5 * 60 * 1000),
          })
        );

        // 2. Create pending payment
        const payment = await paymentRepo.save(
          paymentRepo.create({
            reservation_id: reservation.id,
            amount: "3000.00",
            status: "PENDING",
            idempotency_key: crypto.randomUUID(),
          })
        );

        // 3. Send successful callback
        const res = await request(app)
          .post(`/payments/${payment.id}/callback`)
          .send({ outcome: "SUCCESS" });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe("SUCCEEDED");
        expect(res.body.reservationStatus).toBe("CONFIRMED");

        // 4. Verify in DB
        const dbPayment = await paymentRepo.findOne({ where: { id: payment.id } });
        expect(dbPayment?.status).toBe("SUCCEEDED");
        expect(dbPayment?.completed_at).toBeDefined();

        const dbReservation = await reservationRepo.findOne({ where: { id: reservation.id } });
        expect(dbReservation?.status).toBe("CONFIRMED");
      });
    });

    describe("Duplicate success callbacks and partial unique index backstop", () => {
      it("treats duplicate callback on already-succeeded payment as no-op", async () => {
        const reservationRepo = AppDataSource.getRepository(Reservation);
        const paymentRepo = AppDataSource.getRepository(Payment);

        const reservation = await reservationRepo.save(
          reservationRepo.create({
            departure_id: testDeparture.id,
            passenger_id: passengerA.id,
            status: "PENDING_PAYMENT",
            fare_amount: "3000.00",
            hold_expires_at: new Date(Date.now() + 5 * 60 * 1000),
          })
        );

        const payment = await paymentRepo.save(
          paymentRepo.create({
            reservation_id: reservation.id,
            amount: "3000.00",
            status: "PENDING",
            idempotency_key: crypto.randomUUID(),
          })
        );

        // First callback: succeeds
        const res1 = await request(app)
          .post(`/payments/${payment.id}/callback`)
          .send({ outcome: "SUCCESS" });
        expect(res1.status).toBe(200);
        expect(res1.body.status).toBe("SUCCEEDED");

        // Second callback on same payment: ignored as no-op
        const res2 = await request(app)
          .post(`/payments/${payment.id}/callback`)
          .send({ outcome: "SUCCESS" });
        expect(res2.status).toBe(200);
        expect(res2.body.status).toBe("IGNORED");
      });

      it("handles duplicate payment success for same reservation via one_successful_payment_per_reservation constraint as no-op", async () => {
        const reservationRepo = AppDataSource.getRepository(Reservation);
        const paymentRepo = AppDataSource.getRepository(Payment);

        const reservation = await reservationRepo.save(
          reservationRepo.create({
            departure_id: testDeparture.id,
            passenger_id: passengerA.id,
            status: "CONFIRMED",
            fare_amount: "3000.00",
            hold_expires_at: new Date(Date.now() + 5 * 60 * 1000),
          })
        );

        // Existing succeeded payment
        await paymentRepo.save(
          paymentRepo.create({
            reservation_id: reservation.id,
            amount: "3000.00",
            status: "SUCCEEDED",
            idempotency_key: crypto.randomUUID(),
          })
        );

        // A second pending payment row created earlier
        const payment2 = await paymentRepo.save(
          paymentRepo.create({
            reservation_id: reservation.id,
            amount: "3000.00",
            status: "PENDING",
            idempotency_key: crypto.randomUUID(),
          })
        );

        // Callback for payment2 arrives with SUCCESS
        const res = await request(app)
          .post(`/payments/${payment2.id}/callback`)
          .send({ outcome: "SUCCESS" });

        // Must be treated as no-op, returning 200 IGNORED
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("IGNORED");

        // Verify only 1 succeeded payment exists
        const succeeded = await paymentRepo.find({
          where: { reservation_id: reservation.id, status: "SUCCEEDED" },
        });
        expect(succeeded.length).toBe(1);
      });
    });

    describe("Standard FAILURE outcome", () => {
      it("updates payment to FAILED and reservation to FAILED when outcome is FAILURE", async () => {
        const reservationRepo = AppDataSource.getRepository(Reservation);
        const paymentRepo = AppDataSource.getRepository(Payment);

        const reservation = await reservationRepo.save(
          reservationRepo.create({
            departure_id: testDeparture.id,
            passenger_id: passengerA.id,
            status: "PENDING_PAYMENT",
            fare_amount: "3000.00",
            hold_expires_at: new Date(Date.now() + 5 * 60 * 1000),
          })
        );

        const payment = await paymentRepo.save(
          paymentRepo.create({
            reservation_id: reservation.id,
            amount: "3000.00",
            status: "PENDING",
            idempotency_key: crypto.randomUUID(),
          })
        );

        const res = await request(app)
          .post(`/payments/${payment.id}/callback`)
          .send({ outcome: "FAILURE" });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe("FAILED");
        expect(res.body.reservationStatus).toBe("FAILED");

        // Verify in DB
        const dbPayment = await paymentRepo.findOne({ where: { id: payment.id } });
        expect(dbPayment?.status).toBe("FAILED");
        expect(dbPayment?.completed_at).toBeDefined();

        const dbReservation = await reservationRepo.findOne({ where: { id: reservation.id } });
        expect(dbReservation?.status).toBe("FAILED");
      });
    });

    describe("Deterministic concurrency serialization at hold expiry boundary", () => {
      afterEach(async () => {
        const paymentRepo = AppDataSource.getRepository(Payment);
        const reservationRepo = AppDataSource.getRepository(Reservation);
        const departureRepo = AppDataSource.getRepository(Departure);

        await paymentRepo.createQueryBuilder().delete().execute();
        await reservationRepo.createQueryBuilder().delete().execute();
        await departureRepo
          .createQueryBuilder()
          .delete()
          .where("id != :id", { id: testDeparture.id })
          .execute();
      });

      it("blocks on departure lock until hold expires and safely treats callback as IGNORED / EXPIRED", async () => {
        const departureRepo = AppDataSource.getRepository(Departure);
        const paymentRepo = AppDataSource.getRepository(Payment);
        const reservationRepo = AppDataSource.getRepository(Reservation);

        // 1. Create a departure with capacity 1
        const departure = await departureRepo.save(
          departureRepo.create({
            driver_id: driver.id,
            vehicle_id: testVehicle.id,
            route_id: testRoute.id,
            mode: "POOLED",
            departure_time: new Date(Date.now() + 48 * 60 * 60 * 1000),
            duration_minutes: 45,
            fare_amount: "3000.00",
            capacity: 1,
            status: "SCHEDULED",
          })
        );

        // Create a reservation in PENDING_PAYMENT for passenger A and a PENDING payment
        const reservation = await reservationRepo.save(
          reservationRepo.create({
            departure_id: departure.id,
            passenger_id: passengerA.id,
            status: "PENDING_PAYMENT",
            fare_amount: "3000.00",
            hold_expires_at: new Date(Date.now() + 10 * 1000),
          })
        );

        const payment = await paymentRepo.save(
          paymentRepo.create({
            reservation_id: reservation.id,
            amount: "3000.00",
            status: "PENDING",
            idempotency_key: crypto.randomUUID(),
          })
        );

        // 2. Open test's own queryRunner transaction and SELECT the departure FOR UPDATE (simulating booking in progress)
        const testRunner = AppDataSource.createQueryRunner();
        await testRunner.connect();
        await testRunner.startTransaction();
        try {
          await testRunner.query(
            `SELECT id FROM departures WHERE id = $1 FOR UPDATE;`,
            [departure.id]
          );

          // UPDATE the reservation's hold_expires_at to now() + 2 seconds right before firing callback
          await AppDataSource.query(
            `UPDATE reservations
             SET hold_expires_at = now() + interval '2 seconds'
             WHERE id = $1;`,
            [reservation.id]
          );

          // 3. Fire POST /payments/:id/callback with outcome SUCCESS, without awaiting it
          let callbackCompleted = false;
          const callbackPromise = request(app)
            .post(`/payments/${payment.id}/callback`)
            .send({ outcome: "SUCCESS" })
            .then((res) => {
              callbackCompleted = true;
              return res;
            });

          // 4. After about 500 ms, assert the callback request has NOT completed (proves it is waiting on departure lock)
          await new Promise((resolve) => setTimeout(resolve, 500));
          expect(callbackCompleted).toBe(false);

          // 5. Wait until hold has expired (~2.5s after setup: 500ms elapsed + 2000ms wait > 2s hold), then commit transaction
          await new Promise((resolve) => setTimeout(resolve, 2000));
          await testRunner.commitTransaction();

          // 6. Await callback. Assert response is IGNORED, payment is EXPIRED, reservation is EXPIRED (not CONFIRMED)
          const res = await callbackPromise;
          expect(res.status).toBe(200);
          expect(res.body.status).toBe("IGNORED");
          expect(res.body.paymentStatus).toBe("EXPIRED");

          const dbPayment = await paymentRepo.findOne({ where: { id: payment.id } });
          expect(dbPayment?.status).toBe("EXPIRED");

          const dbReservation = await reservationRepo.findOne({ where: { id: reservation.id } });
          expect(dbReservation?.status).toBe("EXPIRED");
        } finally {
          if (testRunner.isTransactionActive) {
            await testRunner.rollbackTransaction();
          }
          await testRunner.release();
        }
      }, 15000);
    });
  });

  describe("GET /reservations/:id", () => {
    it("returns reservation details and opportunistically flips expired hold to EXPIRED", async () => {
      const reservationRepo = AppDataSource.getRepository(Reservation);
      const expiredHold = new Date(Date.now() - 10 * 1000);
      const reservation = await reservationRepo.save(
        reservationRepo.create({
          departure_id: testDeparture.id,
          passenger_id: passengerA.id,
          status: "PENDING_PAYMENT",
          fare_amount: "3000.00",
          hold_expires_at: expiredHold,
        })
      );

      const res = await request(app)
        .get(`/reservations/${reservation.id}`)
        .set("Authorization", `Bearer ${passengerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("EXPIRED");
    });
  });
});
