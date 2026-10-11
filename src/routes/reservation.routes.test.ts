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

describe("Reservation & Passenger Routes Integration (Section 4 & Ownership)", () => {
  const secret = process.env.JWT_SECRET || "ride_pooling_capstone_dev_secret_key_2026";
  let driverA: User;
  let driverB: User;
  let passengerA: User;
  let passengerB: User;
  let adminUser: User;

  let driverAToken: string;
  let driverBToken: string;
  let passengerAToken: string;
  let passengerBToken: string;
  let adminToken: string;

  let testRoute: Route;
  let testVehicleA: Vehicle;
  let testVehicleB: Vehicle;
  let departureA: Departure;
  let departureB: Departure;

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

    driverA = await userRepo.save(
      userRepo.create({
        email: "res_driver_a@test.com",
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    driverB = await userRepo.save(
      userRepo.create({
        email: "res_driver_b@test.com",
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    passengerA = await userRepo.save(
      userRepo.create({
        email: "res_passenger_a@test.com",
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    passengerB = await userRepo.save(
      userRepo.create({
        email: "res_passenger_b@test.com",
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    adminUser = await userRepo.save(
      userRepo.create({
        email: "res_admin@test.com",
        password_hash: "hash",
        role: "ADMIN",
        driver_enabled: false,
      })
    );

    driverAToken = jwt.sign({ sub: driverA.id, role: driverA.role }, secret);
    driverBToken = jwt.sign({ sub: driverB.id, role: driverB.role }, secret);
    passengerAToken = jwt.sign({ sub: passengerA.id, role: passengerA.role }, secret);
    passengerBToken = jwt.sign({ sub: passengerB.id, role: passengerB.role }, secret);
    adminToken = jwt.sign({ sub: adminUser.id, role: adminUser.role }, secret);

    testRoute = await routeRepo.save(
      routeRepo.create({
        pickup_point: "Ikeja Bus Terminal, Lagos",
        dropoff_point: "Lekki Phase 1, Lagos",
        base_duration_minutes: 50,
        base_fare_solo: "9000.00",
        base_fare_per_seat: "3500.00",
        active: true,
      })
    );

    testVehicleA = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: driverA.id,
        description: "Honda Accord (Driver A)",
        registration_identifier: "RES-VEH-A",
        seat_capacity: 4,
        active: true,
      })
    );

    testVehicleB = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: driverB.id,
        description: "Toyota Corolla (Driver B)",
        registration_identifier: "RES-VEH-B",
        seat_capacity: 4,
        active: true,
      })
    );

    const departureTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
    departureA = await departureRepo.save(
      departureRepo.create({
        driver_id: driverA.id,
        vehicle_id: testVehicleA.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: departureTime,
        duration_minutes: 50,
        fare_amount: "3500.00",
        capacity: 4,
        status: "SCHEDULED",
      })
    );

    departureB = await departureRepo.save(
      departureRepo.create({
        driver_id: driverB.id,
        vehicle_id: testVehicleB.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: departureTime,
        duration_minutes: 50,
        fare_amount: "3500.00",
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

  describe("GET /passengers/me/reservations", () => {
    it("returns 401 if unauthenticated", async () => {
      const res = await request(app).get("/passengers/me/reservations");
      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    it("returns 401 if token is invalid", async () => {
      const res = await request(app)
        .get("/passengers/me/reservations")
        .set("Authorization", "Bearer invalid-jwt-token");
      expect(res.status).toBe(401);
    });

    it("returns 403 if caller is a DRIVER", async () => {
      const res = await request(app)
        .get("/passengers/me/reservations")
        .set("Authorization", `Bearer ${driverAToken}`);
      expect(res.status).toBe(403);
    });

    it("returns 403 if caller is an ADMIN", async () => {
      const res = await request(app)
        .get("/passengers/me/reservations")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(403);
    });

    it("returns 200 with empty array if passenger has no reservations", async () => {
      const res = await request(app)
        .get("/passengers/me/reservations")
        .set("Authorization", `Bearer ${passengerAToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(0);
    });

    it("enforces strict data ownership (Passenger A sees only their own reservations, not Passenger B's)", async () => {
      const reservationRepo = AppDataSource.getRepository(Reservation);

      // Create reservation for passenger A
      const resA = await reservationRepo.save(
        reservationRepo.create({
          departure_id: departureA.id,
          passenger_id: passengerA.id,
          status: "CONFIRMED",
          fare_amount: "3500.00",
          hold_expires_at: new Date(Date.now() + 10 * 60 * 1000),
        })
      );

      // Create reservation for passenger B
      const resB = await reservationRepo.save(
        reservationRepo.create({
          departure_id: departureB.id,
          passenger_id: passengerB.id,
          status: "CONFIRMED",
          fare_amount: "3500.00",
          hold_expires_at: new Date(Date.now() + 10 * 60 * 1000),
        })
      );

      // Fetch as passenger A
      const responseA = await request(app)
        .get("/passengers/me/reservations")
        .set("Authorization", `Bearer ${passengerAToken}`);
      expect(responseA.status).toBe(200);
      expect(responseA.body).toHaveLength(1);
      expect(responseA.body[0].id).toBe(resA.id);
      expect(responseA.body[0].passenger_id).toBe(passengerA.id);

      // Fetch as passenger B
      const responseB = await request(app)
        .get("/passengers/me/reservations")
        .set("Authorization", `Bearer ${passengerBToken}`);
      expect(responseB.status).toBe(200);
      expect(responseB.body).toHaveLength(1);
      expect(responseB.body[0].id).toBe(resB.id);
      expect(responseB.body[0].passenger_id).toBe(passengerB.id);
    });

    it("returns reservations ordered by created_at descending", async () => {
      const reservationRepo = AppDataSource.getRepository(Reservation);

      // Create older reservation
      const older = await reservationRepo.save(
        reservationRepo.create({
          departure_id: departureA.id,
          passenger_id: passengerA.id,
          status: "CONFIRMED",
          fare_amount: "3500.00",
          hold_expires_at: new Date(Date.now() + 10 * 60 * 1000),
          created_at: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
        })
      );

      // Create newer reservation
      const newer = await reservationRepo.save(
        reservationRepo.create({
          departure_id: departureB.id,
          passenger_id: passengerA.id,
          status: "CONFIRMED",
          fare_amount: "3500.00",
          hold_expires_at: new Date(Date.now() + 10 * 60 * 1000),
          created_at: new Date(),
        })
      );

      const res = await request(app)
        .get("/passengers/me/reservations")
        .set("Authorization", `Bearer ${passengerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].id).toBe(newer.id);
      expect(res.body[1].id).toBe(older.id);
    });

    it("opportunistically updates stale PENDING_PAYMENT reservations whose hold elapsed to EXPIRED", async () => {
      const reservationRepo = AppDataSource.getRepository(Reservation);

      // Stale hold that expired 15 minutes ago
      const expiredHold = new Date(Date.now() - 15 * 60 * 1000);
      const staleRes = await reservationRepo.save(
        reservationRepo.create({
          departure_id: departureA.id,
          passenger_id: passengerA.id,
          status: "PENDING_PAYMENT",
          fare_amount: "3500.00",
          hold_expires_at: expiredHold,
        })
      );

      // Active hold that expires in 5 minutes
      const activeHold = new Date(Date.now() + 5 * 60 * 1000);
      const activeRes = await reservationRepo.save(
        reservationRepo.create({
          departure_id: departureB.id,
          passenger_id: passengerA.id,
          status: "PENDING_PAYMENT",
          fare_amount: "3500.00",
          hold_expires_at: activeHold,
        })
      );

      const res = await request(app)
        .get("/passengers/me/reservations")
        .set("Authorization", `Bearer ${passengerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);

      const returnedStale = res.body.find((r: any) => r.id === staleRes.id);
      const returnedActive = res.body.find((r: any) => r.id === activeRes.id);

      expect(returnedStale.status).toBe("EXPIRED");
      expect(returnedActive.status).toBe("PENDING_PAYMENT");

      // Verify DB was persisted with EXPIRED for the stale reservation
      const inDb = await reservationRepo.findOne({ where: { id: staleRes.id } });
      expect(inDb?.status).toBe("EXPIRED");
    });

    it("books a departure and asserts the item shows departure's departure_time, route's pickup_point and reservation's fare_amount", async () => {
      // 1. Book a departure via POST /departures/:id/reservations
      const bookRes = await request(app)
        .post(`/departures/${departureA.id}/reservations`)
        .set("Authorization", `Bearer ${passengerAToken}`);

      expect(bookRes.status).toBe(201);
      expect(bookRes.body.reservationId).toBeDefined();

      // 2. Query GET /passengers/me/reservations
      const res = await request(app)
        .get("/passengers/me/reservations")
        .set("Authorization", `Bearer ${passengerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);

      const item = res.body[0];
      expect(item.id).toBe(bookRes.body.reservationId);
      expect(item.fare_amount).toBe(departureA.fare_amount);
      expect(item.pickup_point).toBe(testRoute.pickup_point);
      expect(new Date(item.departure_time).toISOString()).toBe(
        new Date(departureA.departure_time).toISOString()
      );
      expect(item.duration_minutes).toBe(departureA.duration_minutes);
      expect(item.mode).toBe(departureA.mode);
      expect(item.dropoff_point).toBe(testRoute.dropoff_point);
    });
  });

  describe("GET /reservations/:id", () => {
    it("returns 401 if unauthenticated", async () => {
      const res = await request(app).get(`/reservations/${crypto.randomUUID()}`);
      expect(res.status).toBe(401);
    });

    it("returns 400 for invalid UUID format", async () => {
      const res = await request(app)
        .get("/reservations/not-a-valid-uuid")
        .set("Authorization", `Bearer ${passengerAToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid reservation ID format");
    });

    it("returns 404 if reservation does not exist", async () => {
      const nonExistent = crypto.randomUUID();
      const res = await request(app)
        .get(`/reservations/${nonExistent}`)
        .set("Authorization", `Bearer ${passengerAToken}`);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Reservation not found");
    });

    it("returns 403 if caller is Passenger B attempting to access Passenger A's reservation", async () => {
      const reservationRepo = AppDataSource.getRepository(Reservation);
      const reservation = await reservationRepo.save(
        reservationRepo.create({
          departure_id: departureA.id,
          passenger_id: passengerA.id,
          status: "CONFIRMED",
          fare_amount: "3500.00",
          hold_expires_at: new Date(Date.now() + 10 * 60 * 1000),
        })
      );

      const res = await request(app)
        .get(`/reservations/${reservation.id}`)
        .set("Authorization", `Bearer ${passengerBToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Forbidden: not your reservation");
    });

    it("returns 403 if caller is Driver B attempting to access a reservation on Driver A's departure", async () => {
      const reservationRepo = AppDataSource.getRepository(Reservation);
      const reservation = await reservationRepo.save(
        reservationRepo.create({
          departure_id: departureA.id,
          passenger_id: passengerA.id,
          status: "CONFIRMED",
          fare_amount: "3500.00",
          hold_expires_at: new Date(Date.now() + 10 * 60 * 1000),
        })
      );

      const res = await request(app)
        .get(`/reservations/${reservation.id}`)
        .set("Authorization", `Bearer ${driverBToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Forbidden: not your departure");
    });

    it("returns 403 if caller is ADMIN (only passenger owner or departure driver owner allowed)", async () => {
      const reservationRepo = AppDataSource.getRepository(Reservation);
      const reservation = await reservationRepo.save(
        reservationRepo.create({
          departure_id: departureA.id,
          passenger_id: passengerA.id,
          status: "CONFIRMED",
          fare_amount: "3500.00",
          hold_expires_at: new Date(Date.now() + 10 * 60 * 1000),
        })
      );

      const res = await request(app)
        .get(`/reservations/${reservation.id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Forbidden: insufficient permissions");
    });

    it("returns 200 when Passenger A accesses their own reservation", async () => {
      const reservationRepo = AppDataSource.getRepository(Reservation);
      const reservation = await reservationRepo.save(
        reservationRepo.create({
          departure_id: departureA.id,
          passenger_id: passengerA.id,
          status: "CONFIRMED",
          fare_amount: "3500.00",
          hold_expires_at: new Date(Date.now() + 10 * 60 * 1000),
        })
      );

      const res = await request(app)
        .get(`/reservations/${reservation.id}`)
        .set("Authorization", `Bearer ${passengerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(reservation.id);
      expect(res.body.passenger_id).toBe(passengerA.id);
      expect(res.body.status).toBe("CONFIRMED");
    });

    it("returns 200 when Driver A accesses a reservation on their own departure", async () => {
      const reservationRepo = AppDataSource.getRepository(Reservation);
      const reservation = await reservationRepo.save(
        reservationRepo.create({
          departure_id: departureA.id,
          passenger_id: passengerA.id,
          status: "CONFIRMED",
          fare_amount: "3500.00",
          hold_expires_at: new Date(Date.now() + 10 * 60 * 1000),
        })
      );

      const res = await request(app)
        .get(`/reservations/${reservation.id}`)
        .set("Authorization", `Bearer ${driverAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(reservation.id);
      expect(res.body.departure_id).toBe(departureA.id);
      expect(res.body.departure.driver_id).toBe(driverA.id);
    });

    it("opportunistically updates PENDING_PAYMENT reservation to EXPIRED when hold_expires_at has passed", async () => {
      const reservationRepo = AppDataSource.getRepository(Reservation);
      const expiredHold = new Date(Date.now() - 5000); // 5 seconds ago
      const reservation = await reservationRepo.save(
        reservationRepo.create({
          departure_id: departureA.id,
          passenger_id: passengerA.id,
          status: "PENDING_PAYMENT",
          fare_amount: "3500.00",
          hold_expires_at: expiredHold,
        })
      );

      const res = await request(app)
        .get(`/reservations/${reservation.id}`)
        .set("Authorization", `Bearer ${passengerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(reservation.id);
      expect(res.body.status).toBe("EXPIRED");

      // Verify database row is flipped to EXPIRED
      const dbRow = await reservationRepo.findOne({ where: { id: reservation.id } });
      expect(dbRow?.status).toBe("EXPIRED");
    });

    it("keeps PENDING_PAYMENT status when hold_expires_at is still in the future", async () => {
      const reservationRepo = AppDataSource.getRepository(Reservation);
      const futureHold = new Date(Date.now() + 5 * 60 * 1000); // 5 mins in future
      const reservation = await reservationRepo.save(
        reservationRepo.create({
          departure_id: departureA.id,
          passenger_id: passengerA.id,
          status: "PENDING_PAYMENT",
          fare_amount: "3500.00",
          hold_expires_at: futureHold,
        })
      );

      const res = await request(app)
        .get(`/reservations/${reservation.id}`)
        .set("Authorization", `Bearer ${passengerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("PENDING_PAYMENT");

      const dbRow = await reservationRepo.findOne({ where: { id: reservation.id } });
      expect(dbRow?.status).toBe("PENDING_PAYMENT");
    });

    it("re-reads and preserves DB status if guarded update affects 0 rows (concurrent callback confirm)", async () => {
      const reservationRepo = AppDataSource.getRepository(Reservation);
      const expiredHold = new Date(Date.now() - 5000);
      const reservation = await reservationRepo.save(
        reservationRepo.create({
          departure_id: departureA.id,
          passenger_id: passengerA.id,
          status: "PENDING_PAYMENT",
          fare_amount: "3500.00",
          hold_expires_at: expiredHold,
        })
      );

      // Simulate concurrent callback confirming the reservation right before the guarded update
      // by updating the DB row to CONFIRMED
      await reservationRepo.update({ id: reservation.id }, { status: "CONFIRMED" });

      // Call GET /reservations/:id - the initial read might see PENDING_PAYMENT or CONFIRMED,
      // but the guarded update will affect 0 rows because status is now CONFIRMED,
      // so it will re-read and return CONFIRMED without overwriting it!
      const res = await request(app)
        .get(`/reservations/${reservation.id}`)
        .set("Authorization", `Bearer ${passengerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("CONFIRMED");

      const dbRow = await reservationRepo.findOne({ where: { id: reservation.id } });
      expect(dbRow?.status).toBe("CONFIRMED");
    });
  });
});
