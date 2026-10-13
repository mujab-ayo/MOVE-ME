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

describe("Trip Progress Endpoints Integration (/departures/:id/arrive, /depart, /complete)", () => {
  const secret = process.env.JWT_SECRET || "ride_pooling_capstone_dev_secret_key_2026";
  let driverA: User;
  let driverB: User;
  let passenger: User;
  let driverAToken: string;
  let driverBToken: string;
  let passengerToken: string;
  let testRoute: Route;
  let testVehicleA: Vehicle;
  let testVehicleB: Vehicle;

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

    driverA = await userRepo.save(
      userRepo.create({
        email: "trip_driver_a@test.com",
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    driverB = await userRepo.save(
      userRepo.create({
        email: "trip_driver_b@test.com",
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    passenger = await userRepo.save(
      userRepo.create({
        email: "trip_passenger@test.com",
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    driverAToken = jwt.sign({ sub: driverA.id, role: driverA.role }, secret);
    driverBToken = jwt.sign({ sub: driverB.id, role: driverB.role }, secret);
    passengerToken = jwt.sign({ sub: passenger.id, role: passenger.role }, secret);

    testRoute = await routeRepo.save(
      routeRepo.create({
        pickup_point: "Ikeja Bus Terminal, Ikeja",
        dropoff_point: "Victoria Island Central, Lagos",
        base_duration_minutes: 45,
        base_fare_solo: "7500.00",
        base_fare_per_seat: "2500.00",
        active: true,
      })
    );

    testVehicleA = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: driverA.id,
        description: "Toyota Camry White",
        registration_identifier: "TRIP-REG-A100",
        seat_capacity: 4,
        active: true,
      })
    );

    testVehicleB = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: driverB.id,
        description: "Honda Civic Black",
        registration_identifier: "TRIP-REG-B200",
        seat_capacity: 4,
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

  it("1. Happy path: arrive, depart, complete in order, with the right status and timestamp each time; CONFIRMED reservations become COMPLETED", async () => {
    const departureRepo = AppDataSource.getRepository(Departure);
    const reservationRepo = AppDataSource.getRepository(Reservation);

    const departure = await departureRepo.save(
      departureRepo.create({
        driver_id: driverA.id,
        vehicle_id: testVehicleA.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: new Date(Date.now() + 3600000),
        duration_minutes: 45,
        fare_amount: "2500.00",
        capacity: 4,
        status: "SCHEDULED",
      })
    );

    const confirmedRes = await reservationRepo.save(
      reservationRepo.create({
        departure_id: departure.id,
        passenger_id: passenger.id,
        status: "CONFIRMED",
        fare_amount: "2500.00",
        hold_expires_at: new Date(Date.now() + 3600000),
      })
    );

    // 1a. Arrive
    const arriveRes = await request(app)
      .post(`/departures/${departure.id}/arrive`)
      .set("Authorization", `Bearer ${driverAToken}`);

    expect(arriveRes.status).toBe(200);
    expect(arriveRes.body).toMatchObject({
      departureId: departure.id,
      status: "ARRIVED",
      arrivedAt: expect.any(String),
    });

    const afterArrive = await departureRepo.findOneBy({ id: departure.id });
    expect(afterArrive?.status).toBe("ARRIVED");
    expect(afterArrive?.arrived_at).not.toBeNull();

    // 1b. Depart
    const departRes = await request(app)
      .post(`/departures/${departure.id}/depart`)
      .set("Authorization", `Bearer ${driverAToken}`);

    expect(departRes.status).toBe(200);
    expect(departRes.body).toMatchObject({
      departureId: departure.id,
      status: "IN_PROGRESS",
      departedAt: expect.any(String),
    });

    const afterDepart = await departureRepo.findOneBy({ id: departure.id });
    expect(afterDepart?.status).toBe("IN_PROGRESS");
    expect(afterDepart?.departed_at).not.toBeNull();

    // 1c. Complete
    const completeRes = await request(app)
      .post(`/departures/${departure.id}/complete`)
      .set("Authorization", `Bearer ${driverAToken}`);

    expect(completeRes.status).toBe(200);
    expect(completeRes.body).toMatchObject({
      departureId: departure.id,
      status: "COMPLETED",
      completedAt: expect.any(String),
    });

    const afterComplete = await departureRepo.findOneBy({ id: departure.id });
    expect(afterComplete?.status).toBe("COMPLETED");
    expect(afterComplete?.completed_at).not.toBeNull();

    // Verify CONFIRMED reservation moved to COMPLETED
    const updatedRes = await reservationRepo.findOneBy({ id: confirmedRes.id });
    expect(updatedRes?.status).toBe("COMPLETED");
  });

  it("2. Out-of-order transitions (depart before arrive, complete before depart, arrive twice) return 409", async () => {
    const departureRepo = AppDataSource.getRepository(Departure);

    const departure = await departureRepo.save(
      departureRepo.create({
        driver_id: driverA.id,
        vehicle_id: testVehicleA.id,
        route_id: testRoute.id,
        mode: "SOLO",
        departure_time: new Date(Date.now() + 3600000),
        duration_minutes: 45,
        fare_amount: "7500.00",
        capacity: 1,
        status: "SCHEDULED",
      })
    );

    // 2a. Depart before arrive on SCHEDULED departure -> 409
    const departEarly = await request(app)
      .post(`/departures/${departure.id}/depart`)
      .set("Authorization", `Bearer ${driverAToken}`);
    expect(departEarly.status).toBe(409);

    // 2b. Complete before depart on SCHEDULED departure -> 409
    const completeEarly = await request(app)
      .post(`/departures/${departure.id}/complete`)
      .set("Authorization", `Bearer ${driverAToken}`);
    expect(completeEarly.status).toBe(409);

    // Now mark arrival properly
    const arriveFirst = await request(app)
      .post(`/departures/${departure.id}/arrive`)
      .set("Authorization", `Bearer ${driverAToken}`);
    expect(arriveFirst.status).toBe(200);

    // 2c. Arrive twice -> 409
    const arriveTwice = await request(app)
      .post(`/departures/${departure.id}/arrive`)
      .set("Authorization", `Bearer ${driverAToken}`);
    expect(arriveTwice.status).toBe(409);

    // 2d. Complete before depart on ARRIVED departure -> 409
    const completeBeforeDepart = await request(app)
      .post(`/departures/${departure.id}/complete`)
      .set("Authorization", `Bearer ${driverAToken}`);
    expect(completeBeforeDepart.status).toBe(409);
  });

  it("3. Another driver gets 403; a passenger gets 403; no token 401; unknown id 404; malformed id 400", async () => {
    const departureRepo = AppDataSource.getRepository(Departure);

    const departure = await departureRepo.save(
      departureRepo.create({
        driver_id: driverA.id,
        vehicle_id: testVehicleA.id,
        route_id: testRoute.id,
        mode: "SOLO",
        departure_time: new Date(Date.now() + 3600000),
        duration_minutes: 45,
        fare_amount: "7500.00",
        capacity: 1,
        status: "SCHEDULED",
      })
    );

    // Another driver (driverB) -> 403
    const driverBArrive = await request(app)
      .post(`/departures/${departure.id}/arrive`)
      .set("Authorization", `Bearer ${driverBToken}`);
    expect(driverBArrive.status).toBe(403);

    const driverBDepart = await request(app)
      .post(`/departures/${departure.id}/depart`)
      .set("Authorization", `Bearer ${driverBToken}`);
    expect(driverBDepart.status).toBe(403);

    const driverBComplete = await request(app)
      .post(`/departures/${departure.id}/complete`)
      .set("Authorization", `Bearer ${driverBToken}`);
    expect(driverBComplete.status).toBe(403);

    // Passenger role -> 403
    const passengerArrive = await request(app)
      .post(`/departures/${departure.id}/arrive`)
      .set("Authorization", `Bearer ${passengerToken}`);
    expect(passengerArrive.status).toBe(403);

    // No token -> 401
    const noToken = await request(app).post(`/departures/${departure.id}/arrive`);
    expect(noToken.status).toBe(401);

    // Unknown id -> 404
    const unknownId = await request(app)
      .post(`/departures/00000000-0000-0000-0000-000000000000/arrive`)
      .set("Authorization", `Bearer ${driverAToken}`);
    expect(unknownId.status).toBe(404);

    // Malformed id -> 400
    const malformedId = await request(app)
      .post(`/departures/not-a-valid-uuid/arrive`)
      .set("Authorization", `Bearer ${driverAToken}`);
    expect(malformedId.status).toBe(400);
  });

  it("4. Delayed trip: driver has departure A (arrived or in progress) and a later, non-overlapping departure B whose scheduled time has already passed (set B's departure_time into the past directly in the database). Arriving at B returns 409 while A is active, and succeeds after A completes.", async () => {
    const departureRepo = AppDataSource.getRepository(Departure);

    // Departure A
    const depA = await departureRepo.save(
      departureRepo.create({
        driver_id: driverA.id,
        vehicle_id: testVehicleA.id,
        route_id: testRoute.id,
        mode: "SOLO",
        departure_time: new Date(Date.now() + 3600000),
        duration_minutes: 30,
        fare_amount: "7500.00",
        capacity: 1,
        status: "SCHEDULED",
      })
    );

    // Departure B: non-overlapping later departure
    const depB = await departureRepo.save(
      departureRepo.create({
        driver_id: driverA.id,
        vehicle_id: testVehicleA.id,
        route_id: testRoute.id,
        mode: "SOLO",
        departure_time: new Date(Date.now() + 7200000),
        duration_minutes: 30,
        fare_amount: "7500.00",
        capacity: 1,
        status: "SCHEDULED",
      })
    );

    // Set B's departure_time into the past directly in the database
    await departureRepo.update(depB.id, {
      departure_time: new Date(Date.now() - 3600000),
    });

    // Driver A arrives at departure A -> becomes active (status ARRIVED)
    const arriveA = await request(app)
      .post(`/departures/${depA.id}/arrive`)
      .set("Authorization", `Bearer ${driverAToken}`);
    expect(arriveA.status).toBe(200);

    // Arriving at B while A is active returns 409 via one_active_trip_per_driver index
    const arriveBWhileActive = await request(app)
      .post(`/departures/${depB.id}/arrive`)
      .set("Authorization", `Bearer ${driverAToken}`);

    expect(arriveBWhileActive.status).toBe(409);
    expect(arriveBWhileActive.body.error).toBe("You already have a trip in progress");

    // Complete departure A
    const departA = await request(app)
      .post(`/departures/${depA.id}/depart`)
      .set("Authorization", `Bearer ${driverAToken}`);
    expect(departA.status).toBe(200);

    const completeA = await request(app)
      .post(`/departures/${depA.id}/complete`)
      .set("Authorization", `Bearer ${driverAToken}`);
    expect(completeA.status).toBe(200);

    // Now arriving at B succeeds!
    const arriveBAfterComplete = await request(app)
      .post(`/departures/${depB.id}/arrive`)
      .set("Authorization", `Bearer ${driverAToken}`);

    expect(arriveBAfterComplete.status).toBe(200);
    expect(arriveBAfterComplete.body.status).toBe("ARRIVED");
  });

  it("5. Booking is closed once the trip starts: after arrive, POST /departures/:id/reservations returns 409, and the departure no longer appears in search", async () => {
    const departureRepo = AppDataSource.getRepository(Departure);

    const futureTime = new Date(Date.now() + 7200000);
    const departure = await departureRepo.save(
      departureRepo.create({
        driver_id: driverA.id,
        vehicle_id: testVehicleA.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: futureTime,
        duration_minutes: 45,
        fare_amount: "2500.00",
        capacity: 4,
        status: "SCHEDULED",
      })
    );

    // Verify departure appears in search before arrival
    const searchBefore = await request(app)
      .get("/departures/search")
      .set("Authorization", `Bearer ${passengerToken}`)
      .query({
        routeId: testRoute.id,
        mode: "POOLED",
        when: "scheduled",
        datetime: new Date(Date.now() + 3600000).toISOString(),
      });

    expect(searchBefore.status).toBe(200);
    const foundBefore = searchBefore.body.results.some((d: any) => d.id === departure.id);
    expect(foundBefore).toBe(true);

    // Driver marks arrival
    const arriveRes = await request(app)
      .post(`/departures/${departure.id}/arrive`)
      .set("Authorization", `Bearer ${driverAToken}`);
    expect(arriveRes.status).toBe(200);

    // Booking attempt returns 409
    const bookRes = await request(app)
      .post(`/departures/${departure.id}/reservations`)
      .set("Authorization", `Bearer ${passengerToken}`);
    expect(bookRes.status).toBe(409);
    expect(bookRes.body.error).toMatch(/eligible/i);

    // Departure no longer appears in search results
    const searchAfter = await request(app)
      .get("/departures/search")
      .set("Authorization", `Bearer ${passengerToken}`)
      .query({
        routeId: testRoute.id,
        mode: "POOLED",
        when: "scheduled",
        datetime: new Date(Date.now() + 3600000).toISOString(),
      });

    expect(searchAfter.status).toBe(200);
    const foundAfter = searchAfter.body.results.some((d: any) => d.id === departure.id);
    expect(foundAfter).toBe(false);
  });

  it("6. Deterministic race: the test opens its own transaction holding SELECT ... FOR UPDATE on the departure, fires a booking (not awaited), waits about 500 ms and asserts it has not completed, then sets the departure to ARRIVED inside its own transaction and commits, then asserts the booking returns 409", async () => {
    const departureRepo = AppDataSource.getRepository(Departure);

    const departure = await departureRepo.save(
      departureRepo.create({
        driver_id: driverA.id,
        vehicle_id: testVehicleA.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: new Date(Date.now() + 3600000),
        duration_minutes: 45,
        fare_amount: "2500.00",
        capacity: 4,
        status: "SCHEDULED",
      })
    );

    // 1. Open dedicated transaction holding SELECT ... FOR UPDATE on departure
    const lockRunner = AppDataSource.createQueryRunner();
    await lockRunner.connect();
    await lockRunner.startTransaction();

    await lockRunner.query(
      `SELECT id, status FROM departures WHERE id = $1 FOR UPDATE;`,
      [departure.id]
    );

    // 2. Fire booking request (NOT awaited)
    let bookingFinished = false;
    let bookingResult: any = null;

    const bookingPromise = request(app)
      .post(`/departures/${departure.id}/reservations`)
      .set("Authorization", `Bearer ${passengerToken}`)
      .then((res) => {
        bookingFinished = true;
        bookingResult = res;
        return res;
      });

    // 3. Wait about 500 ms and assert booking has not completed
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(bookingFinished).toBe(false);

    // 4. Set departure to ARRIVED inside transaction and commit
    await lockRunner.query(
      `UPDATE departures SET status = 'ARRIVED', arrived_at = now() WHERE id = $1;`,
      [departure.id]
    );

    await lockRunner.commitTransaction();
    await lockRunner.release();

    // 5. Await booking and assert it returns 409
    const res = await bookingPromise;
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/eligible/i);
  });
});
