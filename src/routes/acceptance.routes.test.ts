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

describe("MM-04-06 Acceptance Integration Coverage", () => {
  const secret = process.env.JWT_SECRET || "ride_pooling_capstone_dev_secret_key_2026";
  let driver: User;
  let passengerA: User;
  let passengerB: User;
  let passengerAToken: string;
  let passengerBToken: string;
  let testRoute: Route;
  let vehicle1: Vehicle;
  let vehicle2: Vehicle;
  let vehicle3: Vehicle;
  let vehicle4: Vehicle;

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

    // Clean up database tables
    await paymentRepo.createQueryBuilder().delete().execute();
    await reservationRepo.createQueryBuilder().delete().execute();
    await departureRepo.createQueryBuilder().delete().execute();
    await vehicleRepo.createQueryBuilder().delete().execute();
    await userRepo.createQueryBuilder().delete().execute();
    await routeRepo.createQueryBuilder().delete().execute();

    // Create test driver
    driver = await userRepo.save(
      userRepo.create({
        email: "acceptance_driver@test.com",
        password_hash: "dummy_hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    // Create distinct vehicles to isolate tests from overlap exclusion constraints
    vehicle1 = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: driver.id,
        registration_identifier: "ACC-VEH-01",
        seat_capacity: 1,
        description: "Solo Car 1",
      })
    );

    vehicle2 = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: driver.id,
        registration_identifier: "ACC-VEH-02",
        seat_capacity: 1,
        description: "Solo Car 2",
      })
    );

    vehicle3 = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: driver.id,
        registration_identifier: "ACC-VEH-03",
        seat_capacity: 1,
        description: "Solo Car 3",
      })
    );

    vehicle4 = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: driver.id,
        registration_identifier: "ACC-VEH-04",
        seat_capacity: 1,
        description: "Solo Car 4",
      })
    );

    // Create test route
    testRoute = await routeRepo.save(
      routeRepo.create({
        pickup_point: "Ikeja Bus Terminal, Lagos",
        dropoff_point: "Victoria Island, Lagos",
        base_duration_minutes: 45,
        base_fare_solo: "5000.00",
        base_fare_per_seat: "2000.00",
        active: true,
      })
    );

    // Create test passengers directly with dummy password hash for speed
    passengerA = await userRepo.save(
      userRepo.create({
        email: "acceptance_p_a@test.com",
        password_hash: "dummy_hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    passengerB = await userRepo.save(
      userRepo.create({
        email: "acceptance_p_b@test.com",
        password_hash: "dummy_hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    passengerAToken = jwt.sign({ sub: passengerA.id, role: passengerA.role }, secret);
    passengerBToken = jwt.sign({ sub: passengerB.id, role: passengerB.role }, secret);
  });

  it("1. Failure releases capacity: SOLO departure; passenger A books, pays, callback FAILURE; then passenger B books the same departure and gets 201", async () => {
    const departureRepo = AppDataSource.getRepository(Departure);
    const reservationRepo = AppDataSource.getRepository(Reservation);

    const departure = await departureRepo.save(
      departureRepo.create({
        driver_id: driver.id,
        vehicle_id: vehicle1.id,
        route_id: testRoute.id,
        mode: "SOLO",
        departure_time: new Date(Date.now() + 24 * 3600 * 1000), // tomorrow
        duration_minutes: 45,
        fare_amount: "5000.00",
        capacity: 1,
        status: "SCHEDULED",
      })
    );

    // Passenger A books
    const bookResA = await request(app)
      .post(`/departures/${departure.id}/reservations`)
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(bookResA.status).toBe(201);
    const reservationIdA = bookResA.body.reservationId;

    // Passenger A initiates payment
    const payResA = await request(app)
      .post(`/reservations/${reservationIdA}/payments`)
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(payResA.status).toBe(201);
    const paymentIdA = payResA.body.paymentId;

    // Callback arrives with FAILURE
    const cbRes = await request(app)
      .post(`/payments/${paymentIdA}/callback`)
      .send({ outcome: "FAILURE" });
    expect(cbRes.status).toBe(200);
    expect(cbRes.body.status).toBe("FAILED");
    expect(cbRes.body.reservationStatus).toBe("FAILED");

    // Passenger B books the same departure and gets 201
    const bookResB = await request(app)
      .post(`/departures/${departure.id}/reservations`)
      .set("Authorization", `Bearer ${passengerBToken}`);
    expect(bookResB.status).toBe(201);
    expect(bookResB.body.status).toBe("PENDING_PAYMENT");

    // Database verification: A is FAILED, B is PENDING_PAYMENT
    const dbResA = await reservationRepo.findOne({ where: { id: reservationIdA } });
    expect(dbResA?.status).toBe("FAILED");

    const dbResB = await reservationRepo.findOne({ where: { id: bookResB.body.reservationId } });
    expect(dbResB?.status).toBe("PENDING_PAYMENT");
  });

  it("2. Expiry releases capacity: SOLO departure; A books and initiates payment; set hold_expires_at into the past; a late SUCCESS callback returns IGNORED; then B books the same departure and gets 201. A's reservation ends EXPIRED, never CONFIRMED", async () => {
    const departureRepo = AppDataSource.getRepository(Departure);
    const reservationRepo = AppDataSource.getRepository(Reservation);

    const departure = await departureRepo.save(
      departureRepo.create({
        driver_id: driver.id,
        vehicle_id: vehicle2.id,
        route_id: testRoute.id,
        mode: "SOLO",
        departure_time: new Date(Date.now() + 48 * 3600 * 1000), // 2 days later
        duration_minutes: 45,
        fare_amount: "5000.00",
        capacity: 1,
        status: "SCHEDULED",
      })
    );

    // A books
    const bookResA = await request(app)
      .post(`/departures/${departure.id}/reservations`)
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(bookResA.status).toBe(201);
    const reservationIdA = bookResA.body.reservationId;

    // A initiates payment
    const payResA = await request(app)
      .post(`/reservations/${reservationIdA}/payments`)
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(payResA.status).toBe(201);
    const paymentIdA = payResA.body.paymentId;

    // Set hold_expires_at into the past
    await reservationRepo.update(
      { id: reservationIdA },
      { hold_expires_at: new Date(Date.now() - 60000) }
    );

    // Late SUCCESS callback returns IGNORED
    const cbRes = await request(app)
      .post(`/payments/${paymentIdA}/callback`)
      .send({ outcome: "SUCCESS" });
    expect(cbRes.status).toBe(200);
    expect(cbRes.body.status).toBe("IGNORED");

    // B books the same departure and gets 201
    const bookResB = await request(app)
      .post(`/departures/${departure.id}/reservations`)
      .set("Authorization", `Bearer ${passengerBToken}`);
    expect(bookResB.status).toBe(201);
    expect(bookResB.body.status).toBe("PENDING_PAYMENT");

    // A's reservation ends EXPIRED, never CONFIRMED
    const dbResA = await reservationRepo.findOne({ where: { id: reservationIdA } });
    expect(dbResA?.status).toBe("EXPIRED");
    expect(dbResA?.status).not.toBe("CONFIRMED");
  });

  it("3. First acceptance scenario end to end: A books a SOLO departure, pays, SUCCESS callback. Assert A's reservation is CONFIRMED, B's booking attempt gets 409, and the departure no longer appears in GET /departures/search", async () => {
    const departureRepo = AppDataSource.getRepository(Departure);

    const targetDepartureTime = new Date(Date.now() + 72 * 3600 * 1000); // 3 days later
    const departure = await departureRepo.save(
      departureRepo.create({
        driver_id: driver.id,
        vehicle_id: vehicle3.id,
        route_id: testRoute.id,
        mode: "SOLO",
        departure_time: targetDepartureTime,
        duration_minutes: 45,
        fare_amount: "5000.00",
        capacity: 1,
        status: "SCHEDULED",
      })
    );

    // A books a SOLO departure
    const bookResA = await request(app)
      .post(`/departures/${departure.id}/reservations`)
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(bookResA.status).toBe(201);
    const reservationIdA = bookResA.body.reservationId;

    // A pays (initiates payment)
    const payResA = await request(app)
      .post(`/reservations/${reservationIdA}/payments`)
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(payResA.status).toBe(201);
    const paymentIdA = payResA.body.paymentId;

    // SUCCESS callback
    const cbRes = await request(app)
      .post(`/payments/${paymentIdA}/callback`)
      .send({ outcome: "SUCCESS" });
    expect(cbRes.status).toBe(200);
    expect(cbRes.body.status).toBe("SUCCEEDED");
    expect(cbRes.body.reservationStatus).toBe("CONFIRMED");

    // Assert A's reservation is CONFIRMED
    const getResA = await request(app)
      .get(`/reservations/${reservationIdA}`)
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(getResA.status).toBe(200);
    expect(getResA.body.status).toBe("CONFIRMED");

    // B's booking attempt gets 409
    const bookResB = await request(app)
      .post(`/departures/${departure.id}/reservations`)
      .set("Authorization", `Bearer ${passengerBToken}`);
    expect(bookResB.status).toBe(409);
    expect(bookResB.body.error).toBe("No available capacity on this departure");

    // Departure no longer appears in GET /departures/search
    const searchRes = await request(app)
      .get("/departures/search")
      .query({
        routeId: testRoute.id,
        mode: "SOLO",
        when: "scheduled",
        datetime: targetDepartureTime.toISOString(),
      })
      .set("Authorization", `Bearer ${passengerBToken}`);

    expect(searchRes.status).toBe(200);
    const matching = (searchRes.body.results || []).filter(
      (d: any) => d.id === departure.id || d.departureId === departure.id
    );
    expect(matching).toHaveLength(0);
  });

  it("4. Later-departure scenario: a passenger books a departure two days ahead, and GET /passengers/me/reservations shows the correct departure_time and fare_amount", async () => {
    const departureRepo = AppDataSource.getRepository(Departure);
    const userRepo = AppDataSource.getRepository(User);
    const vehicleRepo = AppDataSource.getRepository(Vehicle);

    // Dedicated driver and vehicle for Test 4 to avoid driver overlap constraint with Test 2
    const driver4 = await userRepo.save(
      userRepo.create({
        email: "acceptance_driver_4@test.com",
        password_hash: "dummy_hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    const testVehicle4 = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: driver4.id,
        registration_identifier: "ACC-VEH-04-SPEC",
        seat_capacity: 1,
        description: "Solo Car 4 Special",
      })
    );

    // Two days ahead
    const twoDaysAhead = new Date(Date.now() + 2 * 24 * 3600 * 1000);
    const fare = "6500.00";
    const departure = await departureRepo.save(
      departureRepo.create({
        driver_id: driver4.id,
        vehicle_id: testVehicle4.id,
        route_id: testRoute.id,
        mode: "SOLO",
        departure_time: twoDaysAhead,
        duration_minutes: 45,
        fare_amount: fare,
        capacity: 1,
        status: "SCHEDULED",
      })
    );

    // Passenger A books
    const bookRes = await request(app)
      .post(`/departures/${departure.id}/reservations`)
      .set("Authorization", `Bearer ${passengerAToken}`);
    expect(bookRes.status).toBe(201);
    const reservationId = bookRes.body.reservationId;

    // GET /passengers/me/reservations shows correct departure_time and fare_amount
    const listRes = await request(app)
      .get("/passengers/me/reservations")
      .set("Authorization", `Bearer ${passengerAToken}`);

    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);

    const reservationItem = listRes.body.find((r: any) => r.id === reservationId);
    expect(reservationItem).toBeDefined();
    expect(new Date(reservationItem.departure_time).toISOString()).toBe(
      twoDaysAhead.toISOString()
    );
    expect(reservationItem.fare_amount).toBe(fare);
  });
});
