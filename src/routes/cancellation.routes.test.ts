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

describe("Passenger Reservation Cancellation Integration (MM-08 / Section 4 & 5)", () => {
  const secret = process.env.JWT_SECRET || "ride_pooling_capstone_dev_secret_key_2026";
  let driver: User;
  let passengerA: User;
  let passengerB: User;
  let driverToken: string;
  let passengerAToken: string;
  let passengerBToken: string;
  let testRoute: Route;
  let testVehicle: Vehicle;
  let testVehicleSolo: Vehicle;

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

    await warmPool(20);

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

    driver = await userRepo.save(
      userRepo.create({
        email: "cancel_driver@test.com",
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    passengerA = await userRepo.save(
      userRepo.create({
        email: "cancel_passenger_a@test.com",
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    passengerB = await userRepo.save(
      userRepo.create({
        email: "cancel_passenger_b@test.com",
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
        pickup_point: "Ikeja Bus Terminal, Ikeja, Lagos",
        dropoff_point: "Marina Bus Stop, CMS, Lagos",
        base_duration_minutes: 45,
        base_fare_solo: "8000.00",
        base_fare_per_seat: "3000.00",
        active: true,
      })
    );

    testVehicle = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: driver.id,
        description: "Toyota HiAce Bus",
        registration_identifier: "CANCEL-POOL-01",
        seat_capacity: 4,
        active: true,
      })
    );

    testVehicleSolo = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: driver.id,
        description: "Toyota Corolla Sedan",
        registration_identifier: "CANCEL-SOLO-01",
        seat_capacity: 1,
        active: true,
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
    const departureRepo = AppDataSource.getRepository(Departure);

    await paymentRepo.createQueryBuilder().delete().execute();
    await reservationRepo.createQueryBuilder().delete().execute();
    await departureRepo.createQueryBuilder().delete().execute();
  });

  it("1. Happy path: book, pay (SUCCESS), cancel. The reservation is CANCELLED with cancelled_at and the reason; the payment is REFUNDED with refunded_at; the response carries a refund amount equal to the fare.", async () => {
    const departureRepo = AppDataSource.getRepository(Departure);
    const reservationRepo = AppDataSource.getRepository(Reservation);
    const paymentRepo = AppDataSource.getRepository(Payment);

    // 1. Create scheduled departure 2 hours in the future
    const departure = await departureRepo.save(
      departureRepo.create({
        driver_id: driver.id,
        vehicle_id: testVehicle.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: new Date(Date.now() + 2 * 3600 * 1000),
        duration_minutes: 45,
        fare_amount: "3000.00",
        capacity: 4,
        status: "SCHEDULED",
      })
    );

    // 2. Book
    const bookRes = await request(app)
      .post(`/departures/${departure.id}/reservations`)
      .set("Authorization", `Bearer ${passengerAToken}`)
      .send({});
    expect(bookRes.status).toBe(201);
    const reservationId = bookRes.body.reservationId;

    // 3. Initiate payment
    const payRes = await request(app)
      .post(`/reservations/${reservationId}/payments`)
      .set("Authorization", `Bearer ${passengerAToken}`)
      .send({});
    expect(payRes.status).toBe(201);
    const paymentId = payRes.body.paymentId;

    // 4. Callback with SUCCESS
    const callbackRes = await request(app)
      .post(`/payments/${paymentId}/callback`)
      .send({ outcome: "SUCCESS" });
    expect(callbackRes.status).toBe(200);
    expect(callbackRes.body.status).toBe("SUCCEEDED");
    expect(callbackRes.body.reservationStatus).toBe("CONFIRMED");

    // 5. Cancel reservation
    const cancelRes = await request(app)
      .post(`/reservations/${reservationId}/cancel`)
      .set("Authorization", `Bearer ${passengerAToken}`);

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.reservationId).toBe(reservationId);
    expect(cancelRes.body.status).toBe("CANCELLED");
    expect(cancelRes.body.refund).toBeDefined();
    expect(cancelRes.body.refund.simulated).toBe(true);
    expect(cancelRes.body.refund.paymentId).toBe(paymentId);
    expect(cancelRes.body.refund.amount).toBe("3000.00");

    // 6. Verify in DB
    const dbReservation = await reservationRepo.findOne({ where: { id: reservationId } });
    expect(dbReservation?.status).toBe("CANCELLED");
    expect(dbReservation?.cancelled_at).toBeDefined();
    expect(dbReservation?.cancelled_at).not.toBeNull();
    expect(dbReservation?.cancellation_reason).toBe("PASSENGER_CANCELLED");

    const dbPayment = await paymentRepo.findOne({ where: { id: paymentId } });
    expect(dbPayment?.status).toBe("REFUNDED");
    expect(dbPayment?.refunded_at).toBeDefined();
    expect(dbPayment?.refunded_at).not.toBeNull();
  });

  it("2. Capacity is released once: after cancelling on a SOLO departure, a second passenger books it (201) and search lists it again with the right available_capacity. Cancelling again returns 409 and there is still exactly one REFUNDED payment.", async () => {
    const departureRepo = AppDataSource.getRepository(Departure);
    const paymentRepo = AppDataSource.getRepository(Payment);

    // 1. Create SOLO departure (capacity 1)
    const departureTime = new Date(Date.now() + 2 * 3600 * 1000);
    const departure = await departureRepo.save(
      departureRepo.create({
        driver_id: driver.id,
        vehicle_id: testVehicleSolo.id,
        route_id: testRoute.id,
        mode: "SOLO",
        departure_time: departureTime,
        duration_minutes: 45,
        fare_amount: "8000.00",
        capacity: 1,
        status: "SCHEDULED",
      })
    );

    // 2. Passenger A books it
    const bookResA = await request(app)
      .post(`/departures/${departure.id}/reservations`)
      .set("Authorization", `Bearer ${passengerAToken}`)
      .send({});
    expect(bookResA.status).toBe(201);
    const reservationAId = bookResA.body.reservationId;

    // 3. Passenger A pays
    const payResA = await request(app)
      .post(`/reservations/${reservationAId}/payments`)
      .set("Authorization", `Bearer ${passengerAToken}`)
      .send({});
    expect(payResA.status).toBe(201);
    const paymentAId = payResA.body.paymentId;

    // 4. Callback confirms
    await request(app)
      .post(`/payments/${paymentAId}/callback`)
      .send({ outcome: "SUCCESS" });

    // 5. Passenger A cancels reservation
    const cancelResA = await request(app)
      .post(`/reservations/${reservationAId}/cancel`)
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(cancelResA.status).toBe(200);

    // 6. Search lists departure again with available_capacity = 1
    const searchRes = await request(app)
      .get("/departures/search")
      .set("Authorization", `Bearer ${passengerBToken}`)
      .query({
        routeId: testRoute.id,
        mode: "SOLO",
        when: "scheduled",
        datetime: departureTime.toISOString(),
      });
    expect(searchRes.status).toBe(200);
    const foundDep = searchRes.body.results.find((d: any) => d.id === departure.id);
    expect(foundDep).toBeDefined();
    expect(foundDep.available_capacity).toBe(1);

    // 7. Passenger B books it (201)
    const bookResB = await request(app)
      .post(`/departures/${departure.id}/reservations`)
      .set("Authorization", `Bearer ${passengerBToken}`)
      .send({});
    expect(bookResB.status).toBe(201);

    // 8. Cancelling Passenger A's reservation again returns 409
    const cancelAgainRes = await request(app)
      .post(`/reservations/${reservationAId}/cancel`)
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(cancelAgainRes.status).toBe(409);
    expect(cancelAgainRes.body.error).toBe("Only a confirmed reservation can be cancelled");

    // 9. There is still exactly one REFUNDED payment for reservation A
    const refundedPayments = await paymentRepo.find({
      where: { reservation_id: reservationAId, status: "REFUNDED" },
    });
    expect(refundedPayments.length).toBe(1);
  });

  it("3. Concurrent double cancel (Promise.all of two cancels): exactly one 200 and one 409, and exactly one refund.", async () => {
    const departureRepo = AppDataSource.getRepository(Departure);
    const paymentRepo = AppDataSource.getRepository(Payment);

    // 1. Create departure
    const departure = await departureRepo.save(
      departureRepo.create({
        driver_id: driver.id,
        vehicle_id: testVehicle.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: new Date(Date.now() + 2 * 3600 * 1000),
        duration_minutes: 45,
        fare_amount: "3000.00",
        capacity: 4,
        status: "SCHEDULED",
      })
    );

    // 2. Book
    const bookRes = await request(app)
      .post(`/departures/${departure.id}/reservations`)
      .set("Authorization", `Bearer ${passengerAToken}`)
      .send({});
    expect(bookRes.status).toBe(201);
    const reservationId = bookRes.body.reservationId;

    // 3. Pay
    const payRes = await request(app)
      .post(`/reservations/${reservationId}/payments`)
      .set("Authorization", `Bearer ${passengerAToken}`)
      .send({});
    expect(payRes.status).toBe(201);
    const paymentId = payRes.body.paymentId;

    await request(app)
      .post(`/payments/${paymentId}/callback`)
      .send({ outcome: "SUCCESS" });

    // Warm pool before concurrent burst
    await warmPool(10);

    // 4. Concurrent double cancel
    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/reservations/${reservationId}/cancel`)
        .set("Authorization", `Bearer ${passengerAToken}`),
      request(app)
        .post(`/reservations/${reservationId}/cancel`)
        .set("Authorization", `Bearer ${passengerAToken}`),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    // 5. Exactly one refund row in DB
    const refundedPayments = await paymentRepo.find({
      where: { reservation_id: reservationId, status: "REFUNDED" },
    });
    expect(refundedPayments.length).toBe(1);
  });

  it("4. 409 rejections: cancelling a PENDING_PAYMENT reservation; cancelling after departure_time has passed (set it in the past directly); cancelling once the departure is IN_PROGRESS.", async () => {
    const departureRepo = AppDataSource.getRepository(Departure);

    // --- Subcase 4a: cancelling a PENDING_PAYMENT reservation ---
    const depA = await departureRepo.save(
      departureRepo.create({
        driver_id: driver.id,
        vehicle_id: testVehicle.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: new Date(Date.now() + 2 * 3600 * 1000),
        duration_minutes: 45,
        fare_amount: "3000.00",
        capacity: 4,
        status: "SCHEDULED",
      })
    );

    const bookResA = await request(app)
      .post(`/departures/${depA.id}/reservations`)
      .set("Authorization", `Bearer ${passengerAToken}`)
      .send({});
    expect(bookResA.status).toBe(201);
    const resAId = bookResA.body.reservationId;

    const cancelPendingRes = await request(app)
      .post(`/reservations/${resAId}/cancel`)
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(cancelPendingRes.status).toBe(409);
    expect(cancelPendingRes.body.error).toBe("Only a confirmed reservation can be cancelled");

    // --- Subcase 4b: cancelling after departure_time has passed ---
    const depB = await departureRepo.save(
      departureRepo.create({
        driver_id: driver.id,
        vehicle_id: testVehicle.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: new Date(Date.now() + 4 * 3600 * 1000),
        duration_minutes: 45,
        fare_amount: "3000.00",
        capacity: 4,
        status: "SCHEDULED",
      })
    );

    const bookResB = await request(app)
      .post(`/departures/${depB.id}/reservations`)
      .set("Authorization", `Bearer ${passengerAToken}`)
      .send({});
    const resBId = bookResB.body.reservationId;

    const payResB = await request(app)
      .post(`/reservations/${resBId}/payments`)
      .set("Authorization", `Bearer ${passengerAToken}`)
      .send({});
    await request(app)
      .post(`/payments/${payResB.body.paymentId}/callback`)
      .send({ outcome: "SUCCESS" });

    // Set departure_time into the past directly in DB
    await AppDataSource.query(
      `UPDATE departures SET departure_time = now() - interval '1 hour' WHERE id = $1;`,
      [depB.id]
    );

    const cancelPastRes = await request(app)
      .post(`/reservations/${resBId}/cancel`)
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(cancelPastRes.status).toBe(409);
    expect(cancelPastRes.body.error).toMatch(/departure time has passed|already in progress/i);

    // --- Subcase 4c: cancelling once departure is IN_PROGRESS ---
    const depC = await departureRepo.save(
      departureRepo.create({
        driver_id: driver.id,
        vehicle_id: testVehicle.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: new Date(Date.now() + 6 * 3600 * 1000),
        duration_minutes: 45,
        fare_amount: "3000.00",
        capacity: 4,
        status: "SCHEDULED",
      })
    );

    const bookResC = await request(app)
      .post(`/departures/${depC.id}/reservations`)
      .set("Authorization", `Bearer ${passengerAToken}`)
      .send({});
    const resCId = bookResC.body.reservationId;

    const payResC = await request(app)
      .post(`/reservations/${resCId}/payments`)
      .set("Authorization", `Bearer ${passengerAToken}`)
      .send({});
    await request(app)
      .post(`/payments/${payResC.body.paymentId}/callback`)
      .send({ outcome: "SUCCESS" });

    // Set departure status to IN_PROGRESS directly in DB
    await AppDataSource.query(
      `UPDATE departures SET status = 'IN_PROGRESS' WHERE id = $1;`,
      [depC.id]
    );

    const cancelInProgressRes = await request(app)
      .post(`/reservations/${resCId}/cancel`)
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(cancelInProgressRes.status).toBe(409);
    expect(cancelInProgressRes.body.error).toMatch(/departure time has passed|already in progress/i);
  }, 60000);

  it("5. Another passenger gets 403; a driver gets 403; no token 401; unknown id 404; malformed id 400.", async () => {
    const departureRepo = AppDataSource.getRepository(Departure);

    const departure = await departureRepo.save(
      departureRepo.create({
        driver_id: driver.id,
        vehicle_id: testVehicle.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: new Date(Date.now() + 2 * 3600 * 1000),
        duration_minutes: 45,
        fare_amount: "3000.00",
        capacity: 4,
        status: "SCHEDULED",
      })
    );

    const bookRes = await request(app)
      .post(`/departures/${departure.id}/reservations`)
      .set("Authorization", `Bearer ${passengerAToken}`)
      .send({});
    const reservationId = bookRes.body.reservationId;

    const payRes = await request(app)
      .post(`/reservations/${reservationId}/payments`)
      .set("Authorization", `Bearer ${passengerAToken}`)
      .send({});
    await request(app)
      .post(`/payments/${payRes.body.paymentId}/callback`)
      .send({ outcome: "SUCCESS" });

    // Another passenger gets 403
    const resOtherPassenger = await request(app)
      .post(`/reservations/${reservationId}/cancel`)
      .set("Authorization", `Bearer ${passengerBToken}`);
    expect(resOtherPassenger.status).toBe(403);
    expect(resOtherPassenger.body.error).toMatch(/not your reservation/i);

    // Driver gets 403
    const resDriver = await request(app)
      .post(`/reservations/${reservationId}/cancel`)
      .set("Authorization", `Bearer ${driverToken}`);
    expect(resDriver.status).toBe(403);

    // No token 401
    const resNoToken = await request(app).post(`/reservations/${reservationId}/cancel`);
    expect(resNoToken.status).toBe(401);

    // Unknown ID 404
    const unknownId = crypto.randomUUID();
    const resUnknown = await request(app)
      .post(`/reservations/${unknownId}/cancel`)
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(resUnknown.status).toBe(404);
    expect(resUnknown.body.error).toBe("Reservation not found");

    // Malformed ID 400
    const resMalformed = await request(app)
      .post("/reservations/not-a-valid-uuid/cancel")
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(resMalformed.status).toBe(400);
    expect(resMalformed.body.error).toBe("Invalid reservation ID format");
  });
});
