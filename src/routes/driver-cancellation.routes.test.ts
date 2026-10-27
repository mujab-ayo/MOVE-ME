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
import { Notification } from "../entities/notification.entity";

dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env", quiet: true });

describe("Driver Departure Cancellation Integration (MM-08 / docs/design.md)", () => {
  const secret = process.env.JWT_SECRET || "ride_pooling_capstone_dev_secret_key_2026";
  let driverA: User;
  let driverB: User;
  let passenger1: User;
  let passenger2: User;
  let passenger3: User;
  let driverAToken: string;
  let driverBToken: string;
  let passenger1Token: string;
  let passenger2Token: string;
  let passenger3Token: string;
  let testRoute: Route;
  let testVehicleA: Vehicle;
  let testVehicleB: Vehicle;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const notificationRepo = AppDataSource.getRepository(Notification);
    const paymentRepo = AppDataSource.getRepository(Payment);
    const reservationRepo = AppDataSource.getRepository(Reservation);
    const departureRepo = AppDataSource.getRepository(Departure);
    const vehicleRepo = AppDataSource.getRepository(Vehicle);
    const userRepo = AppDataSource.getRepository(User);
    const routeRepo = AppDataSource.getRepository(Route);

    // Clean up
    await notificationRepo.createQueryBuilder().delete().execute();
    await paymentRepo.createQueryBuilder().delete().execute();
    await reservationRepo.createQueryBuilder().delete().execute();
    await departureRepo.createQueryBuilder().delete().execute();
    await vehicleRepo.createQueryBuilder().delete().execute();
    await userRepo.createQueryBuilder().delete().execute();
    await routeRepo.createQueryBuilder().delete().execute();

    driverA = await userRepo.save(
      userRepo.create({
        email: "driver_cancel_a@test.com",
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    driverB = await userRepo.save(
      userRepo.create({
        email: "driver_cancel_b@test.com",
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    passenger1 = await userRepo.save(
      userRepo.create({
        email: "passenger_cancel_1@test.com",
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    passenger2 = await userRepo.save(
      userRepo.create({
        email: "passenger_cancel_2@test.com",
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    passenger3 = await userRepo.save(
      userRepo.create({
        email: "passenger_cancel_3@test.com",
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    driverAToken = jwt.sign({ sub: driverA.id, role: driverA.role }, secret);
    driverBToken = jwt.sign({ sub: driverB.id, role: driverB.role }, secret);
    passenger1Token = jwt.sign({ sub: passenger1.id, role: passenger1.role }, secret);
    passenger2Token = jwt.sign({ sub: passenger2.id, role: passenger2.role }, secret);
    passenger3Token = jwt.sign({ sub: passenger3.id, role: passenger3.role }, secret);

    testRoute = await routeRepo.save(
      routeRepo.create({
        pickup_point: "Ikeja Bus Terminal, Ikeja, Lagos",
        dropoff_point: "Marina Bus Stop, CMS, Lagos",
        base_duration_minutes: 45,
        base_fare_solo: "8000.00",
        base_fare_per_seat: "3000.00",
        active: true,
      })
    );

    testVehicleA = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: driverA.id,
        description: "Toyota HiAce Bus A",
        registration_identifier: "DRV-CANCEL-01",
        seat_capacity: 4,
        active: true,
      })
    );

    testVehicleB = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: driverB.id,
        description: "Toyota HiAce Bus B",
        registration_identifier: "DRV-CANCEL-02",
        seat_capacity: 4,
        active: true,
      })
    );
  }, 60000);

  afterAll(async () => {
    const notificationRepo = AppDataSource.getRepository(Notification);
    const paymentRepo = AppDataSource.getRepository(Payment);
    const reservationRepo = AppDataSource.getRepository(Reservation);
    const departureRepo = AppDataSource.getRepository(Departure);
    const vehicleRepo = AppDataSource.getRepository(Vehicle);
    const userRepo = AppDataSource.getRepository(User);
    const routeRepo = AppDataSource.getRepository(Route);

    await notificationRepo.createQueryBuilder().delete().execute();
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

  beforeEach(async () => {
    const notificationRepo = AppDataSource.getRepository(Notification);
    const paymentRepo = AppDataSource.getRepository(Payment);
    const reservationRepo = AppDataSource.getRepository(Reservation);
    const departureRepo = AppDataSource.getRepository(Departure);

    await notificationRepo.createQueryBuilder().delete().execute();
    await paymentRepo.createQueryBuilder().delete().execute();
    await reservationRepo.createQueryBuilder().delete().execute();
    await departureRepo.createQueryBuilder().delete().execute();
  });

  it("1. Three passengers on a POOLED departure: two paid and CONFIRMED, one PENDING_PAYMENT with a PENDING payment. After the driver cancels: all three reservations CANCELLED; the two payments REFUNDED with the correct amounts; the pending payment EXPIRED; exactly three notifications, each owned by the right passenger with the right payload; the response counts match.", async () => {
    const departureRepo = AppDataSource.getRepository(Departure);
    const reservationRepo = AppDataSource.getRepository(Reservation);
    const paymentRepo = AppDataSource.getRepository(Payment);
    const notificationRepo = AppDataSource.getRepository(Notification);

    // 1. Create scheduled POOLED departure (capacity 4) 2 hours in the future
    const departureTime = new Date(Date.now() + 2 * 3600 * 1000);
    const departure = await departureRepo.save(
      departureRepo.create({
        driver_id: driverA.id,
        vehicle_id: testVehicleA.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: departureTime,
        duration_minutes: 45,
        fare_amount: "3000.00",
        capacity: 4,
        status: "SCHEDULED",
      })
    );

    // 2. Passenger 1: book, pay, callback SUCCESS -> CONFIRMED, SUCCEEDED
    const book1 = await request(app)
      .post(`/departures/${departure.id}/reservations`)
      .set("Authorization", `Bearer ${passenger1Token}`)
      .send({});
    expect(book1.status).toBe(201);
    const res1Id = book1.body.reservationId;

    const pay1 = await request(app)
      .post(`/reservations/${res1Id}/payments`)
      .set("Authorization", `Bearer ${passenger1Token}`)
      .send({});
    expect(pay1.status).toBe(201);
    const pay1Id = pay1.body.paymentId;

    const cb1 = await request(app)
      .post(`/payments/${pay1Id}/callback`)
      .send({ outcome: "SUCCESS" });
    expect(cb1.status).toBe(200);

    // 3. Passenger 2: book, pay, callback SUCCESS -> CONFIRMED, SUCCEEDED
    const book2 = await request(app)
      .post(`/departures/${departure.id}/reservations`)
      .set("Authorization", `Bearer ${passenger2Token}`)
      .send({});
    expect(book2.status).toBe(201);
    const res2Id = book2.body.reservationId;

    const pay2 = await request(app)
      .post(`/reservations/${res2Id}/payments`)
      .set("Authorization", `Bearer ${passenger2Token}`)
      .send({});
    expect(pay2.status).toBe(201);
    const pay2Id = pay2.body.paymentId;

    const cb2 = await request(app)
      .post(`/payments/${pay2Id}/callback`)
      .send({ outcome: "SUCCESS" });
    expect(cb2.status).toBe(200);

    // 4. Passenger 3: book, pay, NO callback -> PENDING_PAYMENT, PENDING
    const book3 = await request(app)
      .post(`/departures/${departure.id}/reservations`)
      .set("Authorization", `Bearer ${passenger3Token}`)
      .send({});
    expect(book3.status).toBe(201);
    const res3Id = book3.body.reservationId;

    const pay3 = await request(app)
      .post(`/reservations/${res3Id}/payments`)
      .set("Authorization", `Bearer ${passenger3Token}`)
      .send({});
    expect(pay3.status).toBe(201);
    const pay3Id = pay3.body.paymentId;

    // 5. Driver A cancels the departure
    const cancelRes = await request(app)
      .post(`/departures/${departure.id}/cancel`)
      .set("Authorization", `Bearer ${driverAToken}`);

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.departureId).toBe(departure.id);
    expect(cancelRes.body.status).toBe("CANCELLED");
    expect(cancelRes.body.cancelledReservations).toBe(3);
    expect(cancelRes.body.refunds).toHaveLength(2);

    const refundedResIds = cancelRes.body.refunds.map((r: any) => r.reservationId);
    expect(refundedResIds).toContain(res1Id);
    expect(refundedResIds).toContain(res2Id);
    for (const r of cancelRes.body.refunds) {
      expect(r.amount).toBe("3000.00");
    }

    // 6. Verify in DB:
    // Departure is CANCELLED with cancelled_at and reason DRIVER_CANCELLED
    const dbDep = await departureRepo.findOne({ where: { id: departure.id } });
    expect(dbDep?.status).toBe("CANCELLED");
    expect(dbDep?.cancelled_at).toBeDefined();
    expect(dbDep?.cancelled_at).not.toBeNull();
    expect(dbDep?.cancellation_reason).toBe("DRIVER_CANCELLED");

    // All three reservations are CANCELLED with DEPARTURE_CANCELLED
    const dbRes1 = await reservationRepo.findOne({ where: { id: res1Id } });
    expect(dbRes1?.status).toBe("CANCELLED");
    expect(dbRes1?.cancelled_at).toBeDefined();
    expect(dbRes1?.cancelled_at).not.toBeNull();
    expect(dbRes1?.cancellation_reason).toBe("DEPARTURE_CANCELLED");

    const dbRes2 = await reservationRepo.findOne({ where: { id: res2Id } });
    expect(dbRes2?.status).toBe("CANCELLED");
    expect(dbRes2?.cancelled_at).toBeDefined();
    expect(dbRes2?.cancelled_at).not.toBeNull();
    expect(dbRes2?.cancellation_reason).toBe("DEPARTURE_CANCELLED");

    const dbRes3 = await reservationRepo.findOne({ where: { id: res3Id } });
    expect(dbRes3?.status).toBe("CANCELLED");
    expect(dbRes3?.cancelled_at).toBeDefined();
    expect(dbRes3?.cancelled_at).not.toBeNull();
    expect(dbRes3?.cancellation_reason).toBe("DEPARTURE_CANCELLED");

    // The two payments are REFUNDED with refunded_at
    const dbPay1 = await paymentRepo.findOne({ where: { id: pay1Id } });
    expect(dbPay1?.status).toBe("REFUNDED");
    expect(dbPay1?.refunded_at).toBeDefined();
    expect(dbPay1?.refunded_at).not.toBeNull();

    const dbPay2 = await paymentRepo.findOne({ where: { id: pay2Id } });
    expect(dbPay2?.status).toBe("REFUNDED");
    expect(dbPay2?.refunded_at).toBeDefined();
    expect(dbPay2?.refunded_at).not.toBeNull();

    // The pending payment is EXPIRED with completed_at
    const dbPay3 = await paymentRepo.findOne({ where: { id: pay3Id } });
    expect(dbPay3?.status).toBe("EXPIRED");
    expect(dbPay3?.completed_at).toBeDefined();
    expect(dbPay3?.completed_at).not.toBeNull();

    // Exactly three notifications, each owned by the right passenger with the right payload
    const notifs = await notificationRepo.find();
    expect(notifs).toHaveLength(3);

    const notif1 = notifs.find((n) => n.user_id === passenger1.id);
    expect(notif1).toBeDefined();
    expect(notif1?.type).toBe("DEPARTURE_CANCELLED");
    expect(notif1?.payload.departureId).toBe(departure.id);
    expect(notif1?.payload.reservationId).toBe(res1Id);
    expect(notif1?.payload.pickupPoint).toBe(testRoute.pickup_point);
    expect(notif1?.payload.dropoffPoint).toBe(testRoute.dropoff_point);
    expect(notif1?.payload.refund).toEqual({ simulated: true, amount: "3000.00" });

    const notif2 = notifs.find((n) => n.user_id === passenger2.id);
    expect(notif2).toBeDefined();
    expect(notif2?.type).toBe("DEPARTURE_CANCELLED");
    expect(notif2?.payload.departureId).toBe(departure.id);
    expect(notif2?.payload.reservationId).toBe(res2Id);
    expect(notif2?.payload.pickupPoint).toBe(testRoute.pickup_point);
    expect(notif2?.payload.dropoffPoint).toBe(testRoute.dropoff_point);
    expect(notif2?.payload.refund).toEqual({ simulated: true, amount: "3000.00" });

    const notif3 = notifs.find((n) => n.user_id === passenger3.id);
    expect(notif3).toBeDefined();
    expect(notif3?.type).toBe("DEPARTURE_CANCELLED");
    expect(notif3?.payload.departureId).toBe(departure.id);
    expect(notif3?.payload.reservationId).toBe(res3Id);
    expect(notif3?.payload.pickupPoint).toBe(testRoute.pickup_point);
    expect(notif3?.payload.dropoffPoint).toBe(testRoute.dropoff_point);
    expect(notif3?.payload.refund).toBeNull();
  }, 60000);

  it("2. The cancelled departure no longer appears in search; booking it returns 409; the driver can publish a new departure in the same time slot (201).", async () => {
    const departureRepo = AppDataSource.getRepository(Departure);

    // 1. Create scheduled departure
    const departureTime = new Date(Date.now() + 3 * 3600 * 1000);
    const departure = await departureRepo.save(
      departureRepo.create({
        driver_id: driverA.id,
        vehicle_id: testVehicleA.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: departureTime,
        duration_minutes: 45,
        fare_amount: "3000.00",
        capacity: 4,
        status: "SCHEDULED",
      })
    );

    // 2. Driver cancels it
    const cancelRes = await request(app)
      .post(`/departures/${departure.id}/cancel`)
      .set("Authorization", `Bearer ${driverAToken}`);
    expect(cancelRes.status).toBe(200);

    // 3. It no longer appears in search
    const searchRes = await request(app)
      .get("/departures/search")
      .set("Authorization", `Bearer ${passenger1Token}`)
      .query({
        routeId: testRoute.id,
        mode: "POOLED",
        when: "scheduled",
        datetime: departureTime.toISOString(),
      });
    expect(searchRes.status).toBe(200);
    const found = searchRes.body.results.find((d: any) => d.id === departure.id);
    expect(found).toBeUndefined();

    // 4. Booking it returns 409
    const bookRes = await request(app)
      .post(`/departures/${departure.id}/reservations`)
      .set("Authorization", `Bearer ${passenger1Token}`)
      .send({});
    expect(bookRes.status).toBe(409);

    // 5. Driver can publish a new departure in the same time slot (201)
    const newDepRes = await request(app)
      .post("/departures")
      .set("Authorization", `Bearer ${driverAToken}`)
      .send({
        vehicleId: testVehicleA.id,
        routeId: testRoute.id,
        mode: "POOLED",
        departureTime: departureTime.toISOString(),
      });
    expect(newDepRes.status).toBe(201);
    expect(newDepRes.body.departureId).toBeDefined();
    expect(newDepRes.body.status).toBe("SCHEDULED");
  });

  it("3. Rejections: cancelling an IN_PROGRESS or COMPLETED departure returns 409; cancelling twice returns 409; another driver gets 403; a passenger gets 403; no token 401; unknown id 404.", async () => {
    const departureRepo = AppDataSource.getRepository(Departure);

    // --- Subcase 3a: cancelling an IN_PROGRESS departure returns 409 ---
    const depInProgress = await departureRepo.save(
      departureRepo.create({
        driver_id: driverA.id,
        vehicle_id: testVehicleA.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: new Date(Date.now() + 4 * 3600 * 1000),
        duration_minutes: 45,
        fare_amount: "3000.00",
        capacity: 4,
        status: "IN_PROGRESS",
      })
    );
    const cancelInProgressRes = await request(app)
      .post(`/departures/${depInProgress.id}/cancel`)
      .set("Authorization", `Bearer ${driverAToken}`);
    expect(cancelInProgressRes.status).toBe(409);
    expect(cancelInProgressRes.body.error).toMatch(/Cannot cancel departure: status is IN_PROGRESS/i);

    // --- Subcase 3b: cancelling a COMPLETED departure returns 409 ---
    const depCompleted = await departureRepo.save(
      departureRepo.create({
        driver_id: driverA.id,
        vehicle_id: testVehicleA.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: new Date(Date.now() + 6 * 3600 * 1000),
        duration_minutes: 45,
        fare_amount: "3000.00",
        capacity: 4,
        status: "COMPLETED",
      })
    );
    const cancelCompletedRes = await request(app)
      .post(`/departures/${depCompleted.id}/cancel`)
      .set("Authorization", `Bearer ${driverAToken}`);
    expect(cancelCompletedRes.status).toBe(409);
    expect(cancelCompletedRes.body.error).toMatch(/Cannot cancel departure: status is COMPLETED/i);

    // --- Subcase 3c: cancelling twice returns 409 ---
    const depScheduled = await departureRepo.save(
      departureRepo.create({
        driver_id: driverA.id,
        vehicle_id: testVehicleA.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: new Date(Date.now() + 8 * 3600 * 1000),
        duration_minutes: 45,
        fare_amount: "3000.00",
        capacity: 4,
        status: "SCHEDULED",
      })
    );
    const cancelFirstRes = await request(app)
      .post(`/departures/${depScheduled.id}/cancel`)
      .set("Authorization", `Bearer ${driverAToken}`);
    expect(cancelFirstRes.status).toBe(200);

    const cancelSecondRes = await request(app)
      .post(`/departures/${depScheduled.id}/cancel`)
      .set("Authorization", `Bearer ${driverAToken}`);
    expect(cancelSecondRes.status).toBe(409);
    expect(cancelSecondRes.body.error).toMatch(/Cannot cancel departure: status is CANCELLED/i);

    // --- Subcase 3d: another driver gets 403 ---
    const depDriverA = await departureRepo.save(
      departureRepo.create({
        driver_id: driverA.id,
        vehicle_id: testVehicleA.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: new Date(Date.now() + 10 * 3600 * 1000),
        duration_minutes: 45,
        fare_amount: "3000.00",
        capacity: 4,
        status: "SCHEDULED",
      })
    );
    const cancelOtherDriverRes = await request(app)
      .post(`/departures/${depDriverA.id}/cancel`)
      .set("Authorization", `Bearer ${driverBToken}`);
    expect(cancelOtherDriverRes.status).toBe(403);
    expect(cancelOtherDriverRes.body.error).toMatch(/you do not own this departure/i);

    // --- Subcase 3e: a passenger gets 403 ---
    const cancelPassengerRes = await request(app)
      .post(`/departures/${depDriverA.id}/cancel`)
      .set("Authorization", `Bearer ${passenger1Token}`);
    expect(cancelPassengerRes.status).toBe(403);

    // --- Subcase 3f: no token 401 ---
    const cancelNoTokenRes = await request(app).post(`/departures/${depDriverA.id}/cancel`);
    expect(cancelNoTokenRes.status).toBe(401);

    // --- Subcase 3g: unknown id 404 ---
    const unknownId = crypto.randomUUID();
    const cancelUnknownRes = await request(app)
      .post(`/departures/${unknownId}/cancel`)
      .set("Authorization", `Bearer ${driverAToken}`);
    expect(cancelUnknownRes.status).toBe(404);
    expect(cancelUnknownRes.body.error).toBe("Departure not found");

    // --- Subcase 3h: malformed id 400 ---
    const cancelMalformedRes = await request(app)
      .post("/departures/invalid-uuid/cancel")
      .set("Authorization", `Bearer ${driverAToken}`);
    expect(cancelMalformedRes.status).toBe(400);
    expect(cancelMalformedRes.body.error).toBe("Invalid departure ID format");
  });

  it("4. Atomicity: make the notification insert fail inside the transaction (for example by stubbing it to throw) and assert nothing changed: the departure is still SCHEDULED, the reservations and payments are unchanged, and the response is the standard 500 error body.", async () => {
    const departureRepo = AppDataSource.getRepository(Departure);
    const reservationRepo = AppDataSource.getRepository(Reservation);
    const paymentRepo = AppDataSource.getRepository(Payment);
    const notificationRepo = AppDataSource.getRepository(Notification);

    // 1. Create scheduled departure
    const departure = await departureRepo.save(
      departureRepo.create({
        driver_id: driverA.id,
        vehicle_id: testVehicleA.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: new Date(Date.now() + 2 * 3600 * 1000),
        duration_minutes: 45,
        fare_amount: "3000.00",
        capacity: 4,
        status: "SCHEDULED",
      })
    );

    // 2. Passenger 1: book, pay -> CONFIRMED, SUCCEEDED
    const book1 = await request(app)
      .post(`/departures/${departure.id}/reservations`)
      .set("Authorization", `Bearer ${passenger1Token}`)
      .send({});
    const res1Id = book1.body.reservationId;

    const pay1 = await request(app)
      .post(`/reservations/${res1Id}/payments`)
      .set("Authorization", `Bearer ${passenger1Token}`)
      .send({});
    const pay1Id = pay1.body.paymentId;

    await request(app)
      .post(`/payments/${pay1Id}/callback`)
      .send({ outcome: "SUCCESS" });

    // 3. Passenger 2: book, pay -> PENDING_PAYMENT, PENDING
    const book2 = await request(app)
      .post(`/departures/${departure.id}/reservations`)
      .set("Authorization", `Bearer ${passenger2Token}`)
      .send({});
    const res2Id = book2.body.reservationId;

    const pay2 = await request(app)
      .post(`/reservations/${res2Id}/payments`)
      .set("Authorization", `Bearer ${passenger2Token}`)
      .send({});
    const pay2Id = pay2.body.paymentId;

    // 4. Stub createQueryRunner to simulate failure when inserting into notifications table
    const originalCreateQueryRunner = AppDataSource.createQueryRunner.bind(AppDataSource);
    const qrSpy = jest.spyOn(AppDataSource, "createQueryRunner").mockImplementation(() => {
      const qr = originalCreateQueryRunner();
      const originalQuery = qr.query.bind(qr);
      qr.query = (queryText: string, parameters?: any[]) => {
        if (typeof queryText === "string" && queryText.includes("notifications")) {
          throw new Error("Simulated notification insert failure");
        }
        return originalQuery(queryText, parameters);
      };
      return qr;
    });

    // 5. Driver cancels -> should fail with 500
    const cancelRes = await request(app)
      .post(`/departures/${departure.id}/cancel`)
      .set("Authorization", `Bearer ${driverAToken}`);

    expect(cancelRes.status).toBe(500);
    expect(cancelRes.body).toEqual({ error: "Internal server error" });

    qrSpy.mockRestore();

    // 6. Assert in DB that NOTHING changed:
    // Departure is still SCHEDULED
    const dbDep = await departureRepo.findOne({ where: { id: departure.id } });
    expect(dbDep?.status).toBe("SCHEDULED");
    expect(dbDep?.cancelled_at).toBeNull();
    expect(dbDep?.cancellation_reason).toBeNull();

    // Reservations are unchanged: res1 is CONFIRMED, res2 is PENDING_PAYMENT
    const dbRes1 = await reservationRepo.findOne({ where: { id: res1Id } });
    expect(dbRes1?.status).toBe("CONFIRMED");
    expect(dbRes1?.cancelled_at).toBeNull();
    expect(dbRes1?.cancellation_reason).toBeNull();

    const dbRes2 = await reservationRepo.findOne({ where: { id: res2Id } });
    expect(dbRes2?.status).toBe("PENDING_PAYMENT");
    expect(dbRes2?.cancelled_at).toBeNull();
    expect(dbRes2?.cancellation_reason).toBeNull();

    // Payments are unchanged: pay1 is SUCCEEDED, pay2 is PENDING
    const dbPay1 = await paymentRepo.findOne({ where: { id: pay1Id } });
    expect(dbPay1?.status).toBe("SUCCEEDED");
    expect(dbPay1?.refunded_at).toBeNull();

    const dbPay2 = await paymentRepo.findOne({ where: { id: pay2Id } });
    expect(dbPay2?.status).toBe("PENDING");
    expect(dbPay2?.completed_at).toBeNull();

    // Zero notifications were committed
    const notifs = await notificationRepo.find();
    expect(notifs).toHaveLength(0);
  }, 60000);
});
