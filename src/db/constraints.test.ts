import crypto from "crypto";
import dotenv from "dotenv";
import { AppDataSource } from "../data-source";

dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env", quiet: true });

describe("Database Constraints & Invariants (Direct SQL)", () => {
  const createdUserIds: string[] = [];
  const createdVehicleIds: string[] = [];
  const createdRouteIds: string[] = [];
  const createdDepartureIds: string[] = [];
  const createdReservationIds: string[] = [];
  const createdPaymentIds: string[] = [];

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
  });

  afterAll(async () => {
    if (AppDataSource.isInitialized) {
      try {
        if (createdPaymentIds.length > 0) {
          await AppDataSource.query(`DELETE FROM payments WHERE id = ANY($1::uuid[])`, [createdPaymentIds]);
        }
        if (createdReservationIds.length > 0) {
          await AppDataSource.query(`DELETE FROM payments WHERE reservation_id = ANY($1::uuid[])`, [createdReservationIds]);
          await AppDataSource.query(`DELETE FROM reservations WHERE id = ANY($1::uuid[])`, [createdReservationIds]);
        }
        if (createdDepartureIds.length > 0) {
          await AppDataSource.query(`DELETE FROM reservations WHERE departure_id = ANY($1::uuid[])`, [createdDepartureIds]);
          await AppDataSource.query(`DELETE FROM departures WHERE id = ANY($1::uuid[])`, [createdDepartureIds]);
        }
        if (createdVehicleIds.length > 0) {
          await AppDataSource.query(`DELETE FROM departures WHERE vehicle_id = ANY($1::uuid[])`, [createdVehicleIds]);
          await AppDataSource.query(`DELETE FROM vehicles WHERE id = ANY($1::uuid[])`, [createdVehicleIds]);
        }
        if (createdRouteIds.length > 0) {
          await AppDataSource.query(`DELETE FROM departures WHERE route_id = ANY($1::uuid[])`, [createdRouteIds]);
          await AppDataSource.query(`DELETE FROM routes WHERE id = ANY($1::uuid[])`, [createdRouteIds]);
        }
        if (createdUserIds.length > 0) {
          await AppDataSource.query(`DELETE FROM departures WHERE driver_id = ANY($1::uuid[])`, [createdUserIds]);
          await AppDataSource.query(`DELETE FROM vehicles WHERE driver_id = ANY($1::uuid[])`, [createdUserIds]);
          await AppDataSource.query(`DELETE FROM reservations WHERE passenger_id = ANY($1::uuid[])`, [createdUserIds]);
          await AppDataSource.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUserIds]);
        }
      } finally {
        await AppDataSource.destroy();
      }
    }
  });

  async function expectPgError(promise: Promise<unknown>, expectedCode: string) {
    let threw = false;
    try {
      await promise;
    } catch (err: any) {
      threw = true;
      const code = err?.code || err?.driverError?.code;
      expect(code).toBe(expectedCode);
    }
    expect(threw).toBe(true);
  }

  async function insertUser(role: "DRIVER" | "PASSENGER" | "ADMIN", driverEnabled = true): Promise<string> {
    const id = crypto.randomUUID();
    const email = `constraint_${id.slice(0, 8)}@test.com`;
    await AppDataSource.query(
      `INSERT INTO users (id, email, password_hash, role, driver_enabled)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, email, "hashed_password", role, driverEnabled]
    );
    createdUserIds.push(id);
    return id;
  }

  async function insertVehicle(driverId: string, seatCapacity = 4): Promise<string> {
    const id = crypto.randomUUID();
    const regId = `REG_${id.slice(0, 8).toUpperCase()}`;
    await AppDataSource.query(
      `INSERT INTO vehicles (id, driver_id, description, registration_identifier, seat_capacity, active)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, driverId, "Constraint Test Vehicle", regId, seatCapacity, true]
    );
    createdVehicleIds.push(id);
    return id;
  }

  async function insertRoute(): Promise<string> {
    const id = crypto.randomUUID();
    await AppDataSource.query(
      `INSERT INTO routes (id, pickup_point, dropoff_point, base_duration_minutes, base_fare_solo, base_fare_per_seat, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, `Pickup ${id.slice(0, 6)}`, `Dropoff ${id.slice(0, 6)}`, 60, "50.00", "20.00", true]
    );
    createdRouteIds.push(id);
    return id;
  }

  async function insertDeparture(params: {
    driverId: string;
    vehicleId: string;
    routeId: string;
    departureTime: Date;
    durationMinutes?: number;
    fareAmount?: string;
    capacity?: number;
    mode?: "SOLO" | "POOLED";
    status?: string;
  }): Promise<string> {
    const id = crypto.randomUUID();
    await AppDataSource.query(
      `INSERT INTO departures (id, driver_id, vehicle_id, route_id, mode, departure_time, duration_minutes, fare_amount, capacity, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        params.driverId,
        params.vehicleId,
        params.routeId,
        params.mode || "POOLED",
        params.departureTime,
        params.durationMinutes ?? 60,
        params.fareAmount ?? "20.00",
        params.capacity ?? 4,
        params.status || "SCHEDULED",
      ]
    );
    createdDepartureIds.push(id);
    return id;
  }

  async function insertReservation(params: {
    departureId: string;
    passengerId: string;
    status?: string;
    fareAmount?: string;
    holdExpiresAt?: Date;
  }): Promise<string> {
    const id = crypto.randomUUID();
    await AppDataSource.query(
      `INSERT INTO reservations (id, departure_id, passenger_id, status, fare_amount, hold_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        params.departureId,
        params.passengerId,
        params.status || "PENDING_PAYMENT",
        params.fareAmount ?? "20.00",
        params.holdExpiresAt || new Date(Date.now() + 15 * 60 * 1000),
      ]
    );
    createdReservationIds.push(id);
    return id;
  }

  async function insertPayment(params: {
    reservationId: string;
    amount?: string;
    status?: string;
    idempotencyKey?: string;
  }): Promise<string> {
    const id = crypto.randomUUID();
    const key = params.idempotencyKey || `idemp_${id}`;
    await AppDataSource.query(
      `INSERT INTO payments (id, reservation_id, amount, status, idempotency_key)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, params.reservationId, params.amount ?? "20.00", params.status || "SUCCEEDED", key]
    );
    createdPaymentIds.push(id);
    return id;
  }

  describe("Driver overlap (exclusion constraints)", () => {
    it("1. Two overlapping departures for the same driver fail with Postgres code 23P01", async () => {
      const driverId = await insertUser("DRIVER");
      const vehicle1Id = await insertVehicle(driverId);
      const vehicle2Id = await insertVehicle(driverId);
      const routeId = await insertRoute();

      const baseTime = new Date("2026-11-01T10:00:00Z");
      await insertDeparture({
        driverId,
        vehicleId: vehicle1Id,
        routeId,
        departureTime: baseTime,
        durationMinutes: 60,
      });

      const overlapTime = new Date("2026-11-01T10:30:00Z");
      await expectPgError(
        insertDeparture({
          driverId,
          vehicleId: vehicle2Id,
          routeId,
          departureTime: overlapTime,
          durationMinutes: 60,
        }),
        "23P01"
      );
    });

    it("2. Two overlapping departures for the same vehicle but different drivers fail with 23P01", async () => {
      const driver1Id = await insertUser("DRIVER");
      const driver2Id = await insertUser("DRIVER");
      const vehicleId = await insertVehicle(driver1Id);
      const routeId = await insertRoute();

      const baseTime = new Date("2026-11-02T10:00:00Z");
      await insertDeparture({
        driverId: driver1Id,
        vehicleId,
        routeId,
        departureTime: baseTime,
        durationMinutes: 60,
      });

      const overlapTime = new Date("2026-11-02T10:30:00Z");
      await expectPgError(
        insertDeparture({
          driverId: driver2Id,
          vehicleId,
          routeId,
          departureTime: overlapTime,
          durationMinutes: 60,
        }),
        "23P01"
      );
    });

    it("3. A departure that starts exactly when another ends (same driver and vehicle) succeeds", async () => {
      const driverId = await insertUser("DRIVER");
      const vehicleId = await insertVehicle(driverId);
      const routeId = await insertRoute();

      const firstStart = new Date("2026-11-03T10:00:00Z");
      const dep1Id = await insertDeparture({
        driverId,
        vehicleId,
        routeId,
        departureTime: firstStart,
        durationMinutes: 60,
      });

      const secondStart = new Date("2026-11-03T11:00:00Z");
      const dep2Id = await insertDeparture({
        driverId,
        vehicleId,
        routeId,
        departureTime: secondStart,
        durationMinutes: 60,
      });

      expect(dep1Id).toBeDefined();
      expect(dep2Id).toBeDefined();
    });

    it("4. An overlapping departure succeeds when the other one has status CANCELLED", async () => {
      const driverId = await insertUser("DRIVER");
      const vehicleId = await insertVehicle(driverId);
      const routeId = await insertRoute();

      const baseTime = new Date("2026-11-04T10:00:00Z");
      const cancelledDepId = await insertDeparture({
        driverId,
        vehicleId,
        routeId,
        departureTime: baseTime,
        durationMinutes: 60,
        status: "CANCELLED",
      });

      const overlapTime = new Date("2026-11-04T10:20:00Z");
      const newDepId = await insertDeparture({
        driverId,
        vehicleId,
        routeId,
        departureTime: overlapTime,
        durationMinutes: 60,
        status: "SCHEDULED",
      });

      expect(cancelledDepId).toBeDefined();
      expect(newDepId).toBeDefined();
    });

    it("5. The function departure_end_time is IMMUTABLE (check pg_proc.provolatile = 'i')", async () => {
      const rows = await AppDataSource.query(
        `SELECT provolatile FROM pg_proc WHERE proname = 'departure_end_time'`
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].provolatile).toBe("i");
    });
  });

  describe("Last seat and payments", () => {
    it("6. Two active (PENDING_PAYMENT or CONFIRMED) reservations for the same passenger and departure fail with 23505; a new one succeeds once the first is CANCELLED", async () => {
      const driverId = await insertUser("DRIVER");
      const vehicleId = await insertVehicle(driverId);
      const routeId = await insertRoute();
      const passengerId = await insertUser("PASSENGER");

      const departureId = await insertDeparture({
        driverId,
        vehicleId,
        routeId,
        departureTime: new Date("2026-11-05T10:00:00Z"),
        durationMinutes: 60,
        capacity: 4,
      });

      const res1Id = await insertReservation({
        departureId,
        passengerId,
        status: "PENDING_PAYMENT",
      });
      expect(res1Id).toBeDefined();

      await expectPgError(
        insertReservation({
          departureId,
          passengerId,
          status: "CONFIRMED",
        }),
        "23505"
      );

      await AppDataSource.query(
        `UPDATE reservations SET status = 'CANCELLED', cancelled_at = now(), cancellation_reason = 'User cancelled' WHERE id = $1`,
        [res1Id]
      );

      const res2Id = await insertReservation({
        departureId,
        passengerId,
        status: "PENDING_PAYMENT",
      });
      expect(res2Id).toBeDefined();
    });

    it("7. Two SUCCEEDED payments for the same reservation fail with 23505", async () => {
      const driverId = await insertUser("DRIVER");
      const vehicleId = await insertVehicle(driverId);
      const routeId = await insertRoute();
      const passengerId = await insertUser("PASSENGER");

      const departureId = await insertDeparture({
        driverId,
        vehicleId,
        routeId,
        departureTime: new Date("2026-11-06T10:00:00Z"),
        durationMinutes: 60,
      });

      const reservationId = await insertReservation({
        departureId,
        passengerId,
        status: "CONFIRMED",
      });

      const payment1Id = await insertPayment({
        reservationId,
        amount: "20.00",
        status: "SUCCEEDED",
        idempotencyKey: `pay_succ_1_${reservationId.slice(0, 8)}`,
      });
      expect(payment1Id).toBeDefined();

      await expectPgError(
        insertPayment({
          reservationId,
          amount: "20.00",
          status: "SUCCEEDED",
          idempotencyKey: `pay_succ_2_${reservationId.slice(0, 8)}`,
        }),
        "23505"
      );
    });

    it("8. One driver with two departures in ARRIVED or IN_PROGRESS fails with 23505", async () => {
      const driverId = await insertUser("DRIVER");
      const vehicle1Id = await insertVehicle(driverId);
      const vehicle2Id = await insertVehicle(driverId);
      const routeId = await insertRoute();

      const dep1Id = await insertDeparture({
        driverId,
        vehicleId: vehicle1Id,
        routeId,
        departureTime: new Date("2026-11-07T10:00:00Z"),
        durationMinutes: 60,
        status: "ARRIVED",
      });
      expect(dep1Id).toBeDefined();

      await expectPgError(
        insertDeparture({
          driverId,
          vehicleId: vehicle2Id,
          routeId,
          departureTime: new Date("2026-11-08T10:00:00Z"),
          durationMinutes: 60,
          status: "IN_PROGRESS",
        }),
        "23505"
      );
    });
  });

  describe("Checks", () => {
    it("9. A departure with capacity 0 and a vehicle with seat_capacity 0 are each rejected (23514)", async () => {
      const driverId = await insertUser("DRIVER");
      const vehicleId = await insertVehicle(driverId);
      const routeId = await insertRoute();

      await expectPgError(
        insertDeparture({
          driverId,
          vehicleId,
          routeId,
          departureTime: new Date("2026-11-09T10:00:00Z"),
          durationMinutes: 60,
          capacity: 0,
        }),
        "23514"
      );

      await expectPgError(
        insertVehicle(driverId, 0),
        "23514"
      );
    });
  });
});
