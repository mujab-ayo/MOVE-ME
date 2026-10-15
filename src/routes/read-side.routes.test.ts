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

dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env" });

describe("Read-side Endpoints Integration (MM-07/08 / docs/design.md Section 4)", () => {
  const secret = process.env.JWT_SECRET || "ride_pooling_capstone_dev_secret_key_2026";
  let driverA: User;
  let driverB: User;
  let passengerA: User;
  let passengerB: User;
  let driverAToken: string;
  let driverBToken: string;
  let passengerAToken: string;
  let passengerBToken: string;
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
        email: "read_driver_a@test.com",
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    driverB = await userRepo.save(
      userRepo.create({
        email: "read_driver_b@test.com",
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    passengerA = await userRepo.save(
      userRepo.create({
        email: "read_passenger_a@test.com",
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    passengerB = await userRepo.save(
      userRepo.create({
        email: "read_passenger_b@test.com",
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    driverAToken = jwt.sign({ sub: driverA.id, role: driverA.role }, secret);
    driverBToken = jwt.sign({ sub: driverB.id, role: driverB.role }, secret);
    passengerAToken = jwt.sign({ sub: passengerA.id, role: passengerA.role }, secret);
    passengerBToken = jwt.sign({ sub: passengerB.id, role: passengerB.role }, secret);

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
        registration_identifier: "READ-SIDE-01",
        seat_capacity: 4,
        active: true,
      })
    );

    testVehicleB = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: driverB.id,
        description: "Toyota HiAce Bus B",
        registration_identifier: "READ-SIDE-02",
        seat_capacity: 4,
        active: true,
      })
    );
  }, 30000);

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
  }, 30000);

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

  it("1. Notifications: ownership, ordering (newest first), unread filter (?unread=true), and idempotent mark-read.", async () => {
    const notificationRepo = AppDataSource.getRepository(Notification);

    // Create notifications for passenger A (one 10m ago, one 5m ago)
    const notifA1 = await notificationRepo.save(
      notificationRepo.create({
        user_id: passengerA.id,
        type: "DEPARTURE_CANCELLED",
        payload: { message: "Earlier notification" },
        created_at: new Date(Date.now() - 10 * 60 * 1000),
      })
    );

    const notifA2 = await notificationRepo.save(
      notificationRepo.create({
        user_id: passengerA.id,
        type: "DEPARTURE_CANCELLED",
        payload: { message: "Later notification" },
        created_at: new Date(Date.now() - 5 * 60 * 1000),
      })
    );

    // Create notification for passenger B
    const notifB1 = await notificationRepo.save(
      notificationRepo.create({
        user_id: passengerB.id,
        type: "DEPARTURE_CANCELLED",
        payload: { message: "Passenger B notification" },
        created_at: new Date(Date.now() - 1 * 60 * 1000),
      })
    );

    // Ownership & ordering: Passenger A only sees own notifications, newest first
    const listResA = await request(app)
      .get("/passengers/me/notifications")
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(listResA.status).toBe(200);
    expect(listResA.body).toHaveLength(2);
    expect(listResA.body[0].id).toBe(notifA2.id);
    expect(listResA.body[1].id).toBe(notifA1.id);
    expect(listResA.body.some((n: any) => n.id === notifB1.id)).toBe(false);

    // Ownership: Passenger B only sees own notification
    const listResB = await request(app)
      .get("/passengers/me/notifications")
      .set("Authorization", `Bearer ${passengerBToken}`);
    expect(listResB.status).toBe(200);
    expect(listResB.body).toHaveLength(1);
    expect(listResB.body[0].id).toBe(notifB1.id);

    // Ownership violation: Passenger B cannot mark Passenger A's notification as read (403)
    const forbiddenRes = await request(app)
      .patch(`/notifications/${notifA1.id}/read`)
      .set("Authorization", `Bearer ${passengerBToken}`);
    expect(forbiddenRes.status).toBe(403);
    expect(forbiddenRes.body.error).toMatch(/not your notification/i);

    // Idempotent mark-read: Passenger A marks notifA1 as read
    const markReadRes = await request(app)
      .patch(`/notifications/${notifA1.id}/read`)
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(markReadRes.status).toBe(200);
    expect(markReadRes.body.id).toBe(notifA1.id);
    const originalReadAt = markReadRes.body.readAt || markReadRes.body.read_at;
    expect(originalReadAt).toBeDefined();

    // Call PATCH /notifications/:id/read again: keeps original read_at
    const markReadAgainRes = await request(app)
      .patch(`/notifications/${notifA1.id}/read`)
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(markReadAgainRes.status).toBe(200);
    const secondReadAt = markReadAgainRes.body.readAt || markReadAgainRes.body.read_at;
    expect(new Date(secondReadAt).getTime()).toBe(new Date(originalReadAt).getTime());

    // Unread filter: ?unread=true returns only unread notifications (notifA2)
    const unreadRes = await request(app)
      .get("/passengers/me/notifications?unread=true")
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(unreadRes.status).toBe(200);
    expect(unreadRes.body).toHaveLength(1);
    expect(unreadRes.body[0].id).toBe(notifA2.id);

    // Without unread filter: returns both
    const allRes = await request(app)
      .get("/passengers/me/notifications")
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(allRes.status).toBe(200);
    expect(allRes.body).toHaveLength(2);

    // Validation checks
    const malformedRes = await request(app)
      .patch("/notifications/invalid-id/read")
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(malformedRes.status).toBe(400);

    const unknownRes = await request(app)
      .patch(`/notifications/${crypto.randomUUID()}/read`)
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(unknownRes.status).toBe(404);

    const noTokenRes = await request(app).patch(`/notifications/${notifA1.id}/read`);
    expect(noTokenRes.status).toBe(401);
  }, 60000);

  it("2. Driver departures: GET /drivers/me/departures ownership, ordering (soonest first), live available_capacity, and reservation counts.", async () => {
    const departureRepo = AppDataSource.getRepository(Departure);

    // Driver A has two departures: depA1 at now + 4h, depA2 at now + 2h
    const timeA1 = new Date(Date.now() + 4 * 3600 * 1000);
    const timeA2 = new Date(Date.now() + 2 * 3600 * 1000);

    const depA1 = await departureRepo.save(
      departureRepo.create({
        driver_id: driverA.id,
        vehicle_id: testVehicleA.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: timeA1,
        duration_minutes: 45,
        fare_amount: "3000.00",
        capacity: 4,
        status: "SCHEDULED",
      })
    );

    const depA2 = await departureRepo.save(
      departureRepo.create({
        driver_id: driverA.id,
        vehicle_id: testVehicleA.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: timeA2,
        duration_minutes: 45,
        fare_amount: "3000.00",
        capacity: 4,
        status: "SCHEDULED",
      })
    );

    // Driver B has one departure: depB1 at now + 3h
    const timeB1 = new Date(Date.now() + 3 * 3600 * 1000);
    const depB1 = await departureRepo.save(
      departureRepo.create({
        driver_id: driverB.id,
        vehicle_id: testVehicleB.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: timeB1,
        duration_minutes: 45,
        fare_amount: "3000.00",
        capacity: 4,
        status: "SCHEDULED",
      })
    );

    // On depA2:
    // Passenger A books and pays (callback SUCCESS) -> CONFIRMED
    const bookA = await request(app)
      .post(`/departures/${depA2.id}/reservations`)
      .set("Authorization", `Bearer ${passengerAToken}`)
      .send({});
    expect(bookA.status).toBe(201);
    const resAId = bookA.body.reservationId;

    const payA = await request(app)
      .post(`/reservations/${resAId}/payments`)
      .set("Authorization", `Bearer ${passengerAToken}`)
      .send({});
    expect(payA.status).toBe(201);

    await request(app)
      .post(`/payments/${payA.body.paymentId}/callback`)
      .send({ outcome: "SUCCESS" });

    // Passenger B books (PENDING_PAYMENT, valid hold)
    const bookB = await request(app)
      .post(`/departures/${depA2.id}/reservations`)
      .set("Authorization", `Bearer ${passengerBToken}`)
      .send({});
    expect(bookB.status).toBe(201);

    // Driver A calls GET /drivers/me/departures
    const listResA = await request(app)
      .get("/drivers/me/departures")
      .set("Authorization", `Bearer ${driverAToken}`);

    expect(listResA.status).toBe(200);
    expect(listResA.body).toHaveLength(2);

    // Soonest first ordering: depA2 (at +2h) must be first, depA1 (at +4h) second
    expect(listResA.body[0].id).toBe(depA2.id);
    expect(listResA.body[1].id).toBe(depA1.id);

    // Check depA2 live capacity and counts
    const first = listResA.body[0];
    expect(first.capacity).toBe(4);
    const availA2 = first.available_capacity ?? first.availableCapacity;
    expect(availA2).toBe(2); // 4 capacity - 1 confirmed - 1 pending = 2
    const confA2 = first.confirmed_reservations ?? first.confirmedReservations;
    expect(confA2).toBe(1);
    const pendA2 = first.pending_reservations ?? first.pendingReservations;
    expect(pendA2).toBe(1);

    // Check depA1 live capacity and counts
    const second = listResA.body[1];
    expect(second.capacity).toBe(4);
    const availA1 = second.available_capacity ?? second.availableCapacity;
    expect(availA1).toBe(4);
    const confA1 = second.confirmed_reservations ?? second.confirmedReservations;
    expect(confA1).toBe(0);
    const pendA1 = second.pending_reservations ?? second.pendingReservations;
    expect(pendA1).toBe(0);

    // Ownership: Driver A does NOT see depB1
    expect(listResA.body.some((d: any) => d.id === depB1.id)).toBe(false);

    // Ownership: Driver B only sees depB1
    const listResB = await request(app)
      .get("/drivers/me/departures")
      .set("Authorization", `Bearer ${driverBToken}`);
    expect(listResB.status).toBe(200);
    expect(listResB.body).toHaveLength(1);
    expect(listResB.body[0].id).toBe(depB1.id);

    // Passenger cannot access driver departures
    const forbiddenRes = await request(app)
      .get("/drivers/me/departures")
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(forbiddenRes.status).toBe(403);

    // No token 401
    const noTokenRes = await request(app).get("/drivers/me/departures");
    expect(noTokenRes.status).toBe(401);
  }, 60000);

  it("3. Passenger reservations: trip_status moving through SCHEDULED, ARRIVED, IN_PROGRESS, COMPLETED and CANCELLED reservations showing reasons.", async () => {
    const departureRepo = AppDataSource.getRepository(Departure);

    // Part A: Trip progress lifecycle on depTrip
    const depTrip = await departureRepo.save(
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

    // Passenger A books and pays
    const bookTrip = await request(app)
      .post(`/departures/${depTrip.id}/reservations`)
      .set("Authorization", `Bearer ${passengerAToken}`)
      .send({});
    expect(bookTrip.status).toBe(201);
    const resTripId = bookTrip.body.reservationId;

    const payTrip = await request(app)
      .post(`/reservations/${resTripId}/payments`)
      .set("Authorization", `Bearer ${passengerAToken}`)
      .send({});
    await request(app)
      .post(`/payments/${payTrip.body.paymentId}/callback`)
      .send({ outcome: "SUCCESS" });

    // Step 1: SCHEDULED
    const list1 = await request(app)
      .get("/passengers/me/reservations")
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(list1.status).toBe(200);
    const item1 = list1.body.find((r: any) => r.id === resTripId);
    expect(item1).toBeDefined();
    expect(item1.trip_status || item1.tripStatus).toBe("SCHEDULED");
    expect(item1.arrived_at || item1.arrivedAt).toBeNull();
    expect(item1.departed_at || item1.departedAt).toBeNull();
    expect(item1.completed_at || item1.completedAt).toBeNull();

    // Step 2: Driver arrives -> ARRIVED
    await request(app)
      .post(`/departures/${depTrip.id}/arrive`)
      .set("Authorization", `Bearer ${driverAToken}`);

    const list2 = await request(app)
      .get("/passengers/me/reservations")
      .set("Authorization", `Bearer ${passengerAToken}`);
    const item2 = list2.body.find((r: any) => r.id === resTripId);
    expect(item2.trip_status || item2.tripStatus).toBe("ARRIVED");
    expect(item2.arrived_at || item2.arrivedAt).toBeDefined();
    expect(item2.arrived_at || item2.arrivedAt).not.toBeNull();

    // Step 3: Driver departs -> IN_PROGRESS
    await request(app)
      .post(`/departures/${depTrip.id}/depart`)
      .set("Authorization", `Bearer ${driverAToken}`);

    const list3 = await request(app)
      .get("/passengers/me/reservations")
      .set("Authorization", `Bearer ${passengerAToken}`);
    const item3 = list3.body.find((r: any) => r.id === resTripId);
    expect(item3.trip_status || item3.tripStatus).toBe("IN_PROGRESS");
    expect(item3.departed_at || item3.departedAt).toBeDefined();
    expect(item3.departed_at || item3.departedAt).not.toBeNull();

    // Step 4: Driver completes -> COMPLETED
    await request(app)
      .post(`/departures/${depTrip.id}/complete`)
      .set("Authorization", `Bearer ${driverAToken}`);

    const list4 = await request(app)
      .get("/passengers/me/reservations")
      .set("Authorization", `Bearer ${passengerAToken}`);
    const item4 = list4.body.find((r: any) => r.id === resTripId);
    expect(item4.trip_status || item4.tripStatus).toBe("COMPLETED");
    expect(item4.status).toBe("COMPLETED");
    expect(item4.completed_at || item4.completedAt).toBeDefined();
    expect(item4.completed_at || item4.completedAt).not.toBeNull();

    // Part B: Cancelled reservation showing its reason
    // Case B1: Passenger cancels
    const depPassCancel = await departureRepo.save(
      departureRepo.create({
        driver_id: driverA.id,
        vehicle_id: testVehicleA.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: new Date(Date.now() + 6 * 3600 * 1000),
        duration_minutes: 45,
        fare_amount: "3000.00",
        capacity: 4,
        status: "SCHEDULED",
      })
    );
    const bookPassCancel = await request(app)
      .post(`/departures/${depPassCancel.id}/reservations`)
      .set("Authorization", `Bearer ${passengerAToken}`)
      .send({});
    const resPassCancelId = bookPassCancel.body.reservationId;
    const payPassCancel = await request(app)
      .post(`/reservations/${resPassCancelId}/payments`)
      .set("Authorization", `Bearer ${passengerAToken}`)
      .send({});
    await request(app)
      .post(`/payments/${payPassCancel.body.paymentId}/callback`)
      .send({ outcome: "SUCCESS" });

    await request(app)
      .post(`/reservations/${resPassCancelId}/cancel`)
      .set("Authorization", `Bearer ${passengerAToken}`);

    // Case B2: Driver cancels departure
    const depDriverCancel = await departureRepo.save(
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
    const bookDriverCancel = await request(app)
      .post(`/departures/${depDriverCancel.id}/reservations`)
      .set("Authorization", `Bearer ${passengerAToken}`)
      .send({});
    const resDriverCancelId = bookDriverCancel.body.reservationId;
    const payDriverCancel = await request(app)
      .post(`/reservations/${resDriverCancelId}/payments`)
      .set("Authorization", `Bearer ${passengerAToken}`)
      .send({});
    await request(app)
      .post(`/payments/${payDriverCancel.body.paymentId}/callback`)
      .send({ outcome: "SUCCESS" });

    await request(app)
      .post(`/departures/${depDriverCancel.id}/cancel`)
      .set("Authorization", `Bearer ${driverAToken}`);

    // Verify GET /passengers/me/reservations shows both cancelled reservations with proper reasons
    const finalList = await request(app)
      .get("/passengers/me/reservations")
      .set("Authorization", `Bearer ${passengerAToken}`);

    const itemPassCancel = finalList.body.find((r: any) => r.id === resPassCancelId);
    expect(itemPassCancel).toBeDefined();
    expect(itemPassCancel.status).toBe("CANCELLED");
    expect(itemPassCancel.cancellation_reason).toBe("PASSENGER_CANCELLED");
    expect(itemPassCancel.cancelled_at).toBeDefined();
    expect(itemPassCancel.cancelled_at).not.toBeNull();

    const itemDriverCancel = finalList.body.find((r: any) => r.id === resDriverCancelId);
    expect(itemDriverCancel).toBeDefined();
    expect(itemDriverCancel.status).toBe("CANCELLED");
    expect(itemDriverCancel.cancellation_reason).toBe("DEPARTURE_CANCELLED");
    expect(itemDriverCancel.trip_status || itemDriverCancel.tripStatus).toBe("CANCELLED");
    expect(itemDriverCancel.cancelled_at).toBeDefined();
    expect(itemDriverCancel.cancelled_at).not.toBeNull();
  }, 90000);
});
