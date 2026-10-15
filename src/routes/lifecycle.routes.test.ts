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

describe("Acceptance Scenarios & End-to-End Lifecycle Integration (MM-01 through MM-08)", () => {
  const secret = process.env.JWT_SECRET || "ride_pooling_capstone_dev_secret_key_2026";

  let enabledDriver: User;
  let disabledDriver: User;
  let secondDriver: User;
  let passenger1: User;
  let passenger2: User;
  let passenger3: User;
  let passenger4: User;
  let passenger5: User;

  let enabledDriverToken: string;
  let disabledDriverToken: string;
  let secondDriverToken: string;
  let passenger1Token: string;
  let passenger2Token: string;
  let passenger3Token: string;
  let passenger4Token: string;
  let passenger5Token: string;

  let activeRoute: Route;
  let inactiveRoute: Route;
  let soloVehicle: Vehicle;
  let pooledVehicle3: Vehicle;
  let secondDriverVehicle: Vehicle;

  const warmPool = async (size = 10) => {
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

    await warmPool(10);

    const notifRepo = AppDataSource.getRepository(Notification);
    const paymentRepo = AppDataSource.getRepository(Payment);
    const reservationRepo = AppDataSource.getRepository(Reservation);
    const departureRepo = AppDataSource.getRepository(Departure);
    const vehicleRepo = AppDataSource.getRepository(Vehicle);
    const userRepo = AppDataSource.getRepository(User);
    const routeRepo = AppDataSource.getRepository(Route);

    // Clean database tables in reverse dependency order
    await notifRepo.createQueryBuilder().delete().execute();
    await paymentRepo.createQueryBuilder().delete().execute();
    await reservationRepo.createQueryBuilder().delete().execute();
    await departureRepo.createQueryBuilder().delete().execute();
    await vehicleRepo.createQueryBuilder().delete().execute();
    await userRepo.createQueryBuilder().delete().execute();
    await routeRepo.createQueryBuilder().delete().execute();

    // 1. Create Drivers
    enabledDriver = await userRepo.save(
      userRepo.create({
        email: `lifecycle_drv_en_${Date.now()}@test.com`,
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    disabledDriver = await userRepo.save(
      userRepo.create({
        email: `lifecycle_drv_dis_${Date.now()}@test.com`,
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: false,
      })
    );

    secondDriver = await userRepo.save(
      userRepo.create({
        email: `lifecycle_drv_sec_${Date.now()}@test.com`,
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    // 2. Create Passengers
    passenger1 = await userRepo.save(
      userRepo.create({
        email: `lifecycle_p1_${Date.now()}@test.com`,
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    passenger2 = await userRepo.save(
      userRepo.create({
        email: `lifecycle_p2_${Date.now()}@test.com`,
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    passenger3 = await userRepo.save(
      userRepo.create({
        email: `lifecycle_p3_${Date.now()}@test.com`,
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    passenger4 = await userRepo.save(
      userRepo.create({
        email: `lifecycle_p4_${Date.now()}@test.com`,
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    passenger5 = await userRepo.save(
      userRepo.create({
        email: `lifecycle_p5_${Date.now()}@test.com`,
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    // 3. Create Tokens
    enabledDriverToken = jwt.sign({ sub: enabledDriver.id, role: enabledDriver.role }, secret);
    disabledDriverToken = jwt.sign({ sub: disabledDriver.id, role: disabledDriver.role }, secret);
    secondDriverToken = jwt.sign({ sub: secondDriver.id, role: secondDriver.role }, secret);

    passenger1Token = jwt.sign({ sub: passenger1.id, role: passenger1.role }, secret);
    passenger2Token = jwt.sign({ sub: passenger2.id, role: passenger2.role }, secret);
    passenger3Token = jwt.sign({ sub: passenger3.id, role: passenger3.role }, secret);
    passenger4Token = jwt.sign({ sub: passenger4.id, role: passenger4.role }, secret);
    passenger5Token = jwt.sign({ sub: passenger5.id, role: passenger5.role }, secret);

    // 4. Create Routes
    activeRoute = await routeRepo.save(
      routeRepo.create({
        pickup_point: "Lifecycle Terminal A, Ikeja",
        dropoff_point: "Lifecycle Terminal B, VI",
        base_duration_minutes: 45,
        base_fare_solo: "6000.00",
        base_fare_per_seat: "2500.00",
        active: true,
      })
    );

    inactiveRoute = await routeRepo.save(
      routeRepo.create({
        pickup_point: "Inactive Pickup Point",
        dropoff_point: "Inactive Dropoff Point",
        base_duration_minutes: 30,
        base_fare_solo: "4000.00",
        base_fare_per_seat: "1500.00",
        active: false,
      })
    );

    // 5. Create Vehicles
    soloVehicle = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: enabledDriver.id,
        description: "Driver 1 Solo Vehicle",
        registration_identifier: `SOLO-${Date.now()}`,
        seat_capacity: 1,
        active: true,
      })
    );

    pooledVehicle3 = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: enabledDriver.id,
        description: "Driver 1 3-Seat Van",
        registration_identifier: `POOL3-${Date.now()}`,
        seat_capacity: 3,
        active: true,
      })
    );

    secondDriverVehicle = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: secondDriver.id,
        description: "Driver 2 Vehicle",
        registration_identifier: `DRV2-${Date.now()}`,
        seat_capacity: 4,
        active: true,
      })
    );
  }, 60000);

  afterAll(async () => {
    const notifRepo = AppDataSource.getRepository(Notification);
    const paymentRepo = AppDataSource.getRepository(Payment);
    const reservationRepo = AppDataSource.getRepository(Reservation);
    const departureRepo = AppDataSource.getRepository(Departure);
    const vehicleRepo = AppDataSource.getRepository(Vehicle);
    const userRepo = AppDataSource.getRepository(User);
    const routeRepo = AppDataSource.getRepository(Route);

    await notifRepo.createQueryBuilder().delete().execute();
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

  describe("Scenario a: SOLO departure full lifecycle", () => {
    it("a passenger finds a SOLO departure in search, books, pays (SUCCESS); a second passenger cannot book it (409); the driver arrives, departs and completes; the passenger's list shows the reservation COMPLETED", async () => {
      // 1. Driver publishes SOLO departure via real API POST /departures
      const departureTime = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      const pubRes = await request(app)
        .post("/departures")
        .set("Authorization", `Bearer ${enabledDriverToken}`)
        .send({
          vehicleId: soloVehicle.id,
          routeId: activeRoute.id,
          mode: "SOLO",
          departureTime,
        });

      expect(pubRes.status).toBe(201);
      const departureId = pubRes.body.departureId;
      expect(pubRes.body.capacity).toBe(1);
      expect(pubRes.body.fareAmount).toBe(activeRoute.base_fare_solo);
      expect(pubRes.body.status).toBe("SCHEDULED");

      // 2. Passenger 1 finds the departure in search
      const searchRes = await request(app)
        .get(
          `/departures/search?routeId=${activeRoute.id}&mode=SOLO&when=scheduled&datetime=${departureTime}`
        )
        .set("Authorization", `Bearer ${passenger1Token}`);

      expect(searchRes.status).toBe(200);
      const found = searchRes.body.results.find((d: any) => d.id === departureId);
      expect(found).toBeDefined();
      expect(found.available_capacity).toBe(1);
      expect(found.fare_amount).toBe(activeRoute.base_fare_solo);

      // 3. Passenger 1 books the SOLO departure
      const bookRes1 = await request(app)
        .post(`/departures/${departureId}/reservations`)
        .set("Authorization", `Bearer ${passenger1Token}`)
        .send({});

      expect(bookRes1.status).toBe(201);
      const reservationId = bookRes1.body.reservationId;
      expect(bookRes1.body.status).toBe("PENDING_PAYMENT");

      // 4. Passenger 1 initiates payment and callback succeeds
      const payRes1 = await request(app)
        .post(`/reservations/${reservationId}/payments`)
        .set("Authorization", `Bearer ${passenger1Token}`)
        .send({});

      expect(payRes1.status).toBe(201);
      const paymentId = payRes1.body.paymentId;

      const callbackRes = await request(app)
        .post(`/payments/${paymentId}/callback`)
        .send({ outcome: "SUCCESS" });

      expect(callbackRes.status).toBe(200);

      // 5. A second passenger attempts to book the SOLO departure -> 409
      const bookRes2 = await request(app)
        .post(`/departures/${departureId}/reservations`)
        .set("Authorization", `Bearer ${passenger2Token}`)
        .send({});

      expect(bookRes2.status).toBe(409);
      expect(bookRes2.body.error).toBe("No available capacity on this departure");

      // 6. Driver arrives, departs, and completes the departure
      const arriveRes = await request(app)
        .post(`/departures/${departureId}/arrive`)
        .set("Authorization", `Bearer ${enabledDriverToken}`);
      expect(arriveRes.status).toBe(200);
      expect(arriveRes.body.status).toBe("ARRIVED");

      const departRes = await request(app)
        .post(`/departures/${departureId}/depart`)
        .set("Authorization", `Bearer ${enabledDriverToken}`);
      expect(departRes.status).toBe(200);
      expect(departRes.body.status).toBe("IN_PROGRESS");

      const completeRes = await request(app)
        .post(`/departures/${departureId}/complete`)
        .set("Authorization", `Bearer ${enabledDriverToken}`);
      expect(completeRes.status).toBe(200);
      expect(completeRes.body.status).toBe("COMPLETED");

      // 7. Passenger's list shows the reservation COMPLETED
      const passListRes = await request(app)
        .get("/passengers/me/reservations")
        .set("Authorization", `Bearer ${passenger1Token}`);

      expect(passListRes.status).toBe(200);
      const myRes = passListRes.body.find((r: any) => r.id === reservationId);
      expect(myRes).toBeDefined();
      expect(myRes.status).toBe("COMPLETED");
      expect(myRes.trip_status).toBe("COMPLETED");
    }, 60000);
  });

  describe("Scenario b: POOLED departure with cancellation, rebooking, and trip lifecycle", () => {
    it("a POOLED departure with three passengers: one cancels and is refunded; a fourth passenger then books the released seat; the driver arrives (booking now returns 409), departs and completes; the remaining reservations end COMPLETED and the cancelled one stays CANCELLED", async () => {
      // 1. Driver publishes POOLED departure with capacity 3
      const departureTime = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
      const pubRes = await request(app)
        .post("/departures")
        .set("Authorization", `Bearer ${enabledDriverToken}`)
        .send({
          vehicleId: pooledVehicle3.id,
          routeId: activeRoute.id,
          mode: "POOLED",
          departureTime,
        });

      expect(pubRes.status).toBe(201);
      const departureId = pubRes.body.departureId;
      expect(pubRes.body.capacity).toBe(3);

      // 2. Three passengers book and pay
      // Passenger 1
      const book1 = await request(app)
        .post(`/departures/${departureId}/reservations`)
        .set("Authorization", `Bearer ${passenger1Token}`);
      expect(book1.status).toBe(201);
      const res1Id = book1.body.reservationId;

      const pay1 = await request(app)
        .post(`/reservations/${res1Id}/payments`)
        .set("Authorization", `Bearer ${passenger1Token}`)
        .send({});
      expect(pay1.status).toBe(201);
      await request(app)
        .post(`/payments/${pay1.body.paymentId}/callback`)
        .send({ outcome: "SUCCESS" });

      // Passenger 2
      const book2 = await request(app)
        .post(`/departures/${departureId}/reservations`)
        .set("Authorization", `Bearer ${passenger2Token}`);
      expect(book2.status).toBe(201);
      const res2Id = book2.body.reservationId;

      const pay2 = await request(app)
        .post(`/reservations/${res2Id}/payments`)
        .set("Authorization", `Bearer ${passenger2Token}`)
        .send({});
      expect(pay2.status).toBe(201);
      await request(app)
        .post(`/payments/${pay2.body.paymentId}/callback`)
        .send({ outcome: "SUCCESS" });

      // Passenger 3
      const book3 = await request(app)
        .post(`/departures/${departureId}/reservations`)
        .set("Authorization", `Bearer ${passenger3Token}`);
      expect(book3.status).toBe(201);
      const res3Id = book3.body.reservationId;

      const pay3 = await request(app)
        .post(`/reservations/${res3Id}/payments`)
        .set("Authorization", `Bearer ${passenger3Token}`)
        .send({});
      expect(pay3.status).toBe(201);
      await request(app)
        .post(`/payments/${pay3.body.paymentId}/callback`)
        .send({ outcome: "SUCCESS" });

      // 3. Passenger 1 cancels and is refunded
      const cancelRes = await request(app)
        .post(`/reservations/${res1Id}/cancel`)
        .set("Authorization", `Bearer ${passenger1Token}`);

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.status).toBe("CANCELLED");
      expect(cancelRes.body.refund?.amount).toBe(activeRoute.base_fare_per_seat);

      // Verify payment row was refunded
      const pay1Get = await request(app)
        .get(`/payments/${pay1.body.paymentId}`)
        .set("Authorization", `Bearer ${passenger1Token}`);
      expect(pay1Get.status).toBe(200);
      expect(pay1Get.body.status).toBe("REFUNDED");

      // 4. A fourth passenger books the released seat and pays
      const book4 = await request(app)
        .post(`/departures/${departureId}/reservations`)
        .set("Authorization", `Bearer ${passenger4Token}`);

      expect(book4.status).toBe(201);
      const res4Id = book4.body.reservationId;

      const pay4 = await request(app)
        .post(`/reservations/${res4Id}/payments`)
        .set("Authorization", `Bearer ${passenger4Token}`)
        .send({});
      expect(pay4.status).toBe(201);
      await request(app)
        .post(`/payments/${pay4.body.paymentId}/callback`)
        .send({ outcome: "SUCCESS" });

      // 5. Driver arrives -> booking now returns 409
      const arriveRes = await request(app)
        .post(`/departures/${departureId}/arrive`)
        .set("Authorization", `Bearer ${enabledDriverToken}`);
      expect(arriveRes.status).toBe(200);

      // Late booking attempt after arrive -> returns 409
      const lateBook = await request(app)
        .post(`/departures/${departureId}/reservations`)
        .set("Authorization", `Bearer ${passenger5Token}`);
      expect(lateBook.status).toBe(409);
      expect(lateBook.body.error).toBe("Departure is not eligible for reservations");

      // 6. Driver departs and completes
      const departRes = await request(app)
        .post(`/departures/${departureId}/depart`)
        .set("Authorization", `Bearer ${enabledDriverToken}`);
      expect(departRes.status).toBe(200);

      const completeRes = await request(app)
        .post(`/departures/${departureId}/complete`)
        .set("Authorization", `Bearer ${enabledDriverToken}`);
      expect(completeRes.status).toBe(200);

      // 7. Verify reservations: remaining end COMPLETED and cancelled stays CANCELLED
      const listP1 = await request(app)
        .get("/passengers/me/reservations")
        .set("Authorization", `Bearer ${passenger1Token}`);
      const r1 = listP1.body.find((item: any) => item.id === res1Id);
      expect(r1.status).toBe("CANCELLED");
      expect(r1.cancellation_reason).toBe("PASSENGER_CANCELLED");

      const listP2 = await request(app)
        .get("/passengers/me/reservations")
        .set("Authorization", `Bearer ${passenger2Token}`);
      const r2 = listP2.body.find((item: any) => item.id === res2Id);
      expect(r2.status).toBe("COMPLETED");

      const listP3 = await request(app)
        .get("/passengers/me/reservations")
        .set("Authorization", `Bearer ${passenger3Token}`);
      const r3 = listP3.body.find((item: any) => item.id === res3Id);
      expect(r3.status).toBe("COMPLETED");

      const listP4 = await request(app)
        .get("/passengers/me/reservations")
        .set("Authorization", `Bearer ${passenger4Token}`);
      const r4 = listP4.body.find((item: any) => item.id === res4Id);
      expect(r4.status).toBe("COMPLETED");
    }, 240000);
  });

  describe("Scenario c: Driver cancels booked departure", () => {
    it("a driver cancels a booked departure: every affected passenger sees the CANCELLED reservation and a DEPARTURE_CANCELLED notification with the refund amount; the departure is gone from search", async () => {
      // 1. Driver publishes POOLED departure
      const departureTime = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
      const pubRes = await request(app)
        .post("/departures")
        .set("Authorization", `Bearer ${enabledDriverToken}`)
        .send({
          vehicleId: pooledVehicle3.id,
          routeId: activeRoute.id,
          mode: "POOLED",
          departureTime,
        });

      expect(pubRes.status).toBe(201);
      const departureId = pubRes.body.departureId;

      // 2. Passenger 1 and Passenger 2 book and pay
      const book1 = await request(app)
        .post(`/departures/${departureId}/reservations`)
        .set("Authorization", `Bearer ${passenger1Token}`);
      const res1Id = book1.body.reservationId;
      const pay1 = await request(app)
        .post(`/reservations/${res1Id}/payments`)
        .set("Authorization", `Bearer ${passenger1Token}`)
        .send({});
      await request(app)
        .post(`/payments/${pay1.body.paymentId}/callback`)
        .send({ outcome: "SUCCESS" });

      const book2 = await request(app)
        .post(`/departures/${departureId}/reservations`)
        .set("Authorization", `Bearer ${passenger2Token}`);
      const res2Id = book2.body.reservationId;
      const pay2 = await request(app)
        .post(`/reservations/${res2Id}/payments`)
        .set("Authorization", `Bearer ${passenger2Token}`)
        .send({});
      await request(app)
        .post(`/payments/${pay2.body.paymentId}/callback`)
        .send({ outcome: "SUCCESS" });

      // Verify departure is visible in search before cancellation
      const searchBefore = await request(app)
        .get(
          `/departures/search?routeId=${activeRoute.id}&mode=POOLED&when=scheduled&datetime=${departureTime}`
        )
        .set("Authorization", `Bearer ${passenger3Token}`);
      expect(searchBefore.body.results.some((d: any) => d.id === departureId)).toBe(true);

      // 3. Driver cancels departure
      const cancelRes = await request(app)
        .post(`/departures/${departureId}/cancel`)
        .set("Authorization", `Bearer ${enabledDriverToken}`);

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.status).toBe("CANCELLED");
      expect(cancelRes.body.cancelledReservations).toBe(2);

      // 4. Passenger 1 sees CANCELLED reservation and DEPARTURE_CANCELLED notification with refund
      const listP1 = await request(app)
        .get("/passengers/me/reservations")
        .set("Authorization", `Bearer ${passenger1Token}`);
      const r1 = listP1.body.find((item: any) => item.id === res1Id);
      expect(r1.status).toBe("CANCELLED");
      expect(r1.cancellation_reason).toBe("DEPARTURE_CANCELLED");

      const notifsP1 = await request(app)
        .get("/passengers/me/notifications")
        .set("Authorization", `Bearer ${passenger1Token}`);
      expect(notifsP1.status).toBe(200);
      const n1 = notifsP1.body.find(
        (n: any) => n.type === "DEPARTURE_CANCELLED" && n.payload.departureId === departureId
      );
      expect(n1).toBeDefined();
      expect(n1.payload.refund).toBeDefined();
      expect(n1.payload.refund.amount).toBe(activeRoute.base_fare_per_seat);

      // 5. Passenger 2 sees CANCELLED reservation and DEPARTURE_CANCELLED notification with refund
      const listP2 = await request(app)
        .get("/passengers/me/reservations")
        .set("Authorization", `Bearer ${passenger2Token}`);
      const r2 = listP2.body.find((item: any) => item.id === res2Id);
      expect(r2.status).toBe("CANCELLED");
      expect(r2.cancellation_reason).toBe("DEPARTURE_CANCELLED");

      const notifsP2 = await request(app)
        .get("/passengers/me/notifications")
        .set("Authorization", `Bearer ${passenger2Token}`);
      expect(notifsP2.status).toBe(200);
      const n2 = notifsP2.body.find(
        (n: any) => n.type === "DEPARTURE_CANCELLED" && n.payload.departureId === departureId
      );
      expect(n2).toBeDefined();
      expect(n2.payload.refund).toBeDefined();
      expect(n2.payload.refund.amount).toBe(activeRoute.base_fare_per_seat);

      // 6. The departure is gone from search
      const searchAfter = await request(app)
        .get(
          `/departures/search?routeId=${activeRoute.id}&mode=POOLED&when=scheduled&datetime=${departureTime}`
        )
        .set("Authorization", `Bearer ${passenger3Token}`);
      expect(searchAfter.body.results.some((d: any) => d.id === departureId)).toBe(false);
    }, 60000);
  });

  describe("Scenario d: Overlap and delay lifecycle rules", () => {
    it("publishing an overlapping departure is rejected (409)", async () => {
      const baseTime = new Date(Date.now() + 96 * 3600 * 1000);
      // Publish first departure
      const res1 = await request(app)
        .post("/departures")
        .set("Authorization", `Bearer ${enabledDriverToken}`)
        .send({
          vehicleId: soloVehicle.id,
          routeId: activeRoute.id,
          mode: "SOLO",
          departureTime: baseTime.toISOString(),
        });
      expect(res1.status).toBe(201);

      // Publish overlapping departure for same driver (starts 15 minutes later, base_duration is 45 mins)
      const overlapTime = new Date(baseTime.getTime() + 15 * 60 * 1000).toISOString();
      const res2 = await request(app)
        .post("/departures")
        .set("Authorization", `Bearer ${enabledDriverToken}`)
        .send({
          vehicleId: pooledVehicle3.id,
          routeId: activeRoute.id,
          mode: "POOLED",
          departureTime: overlapTime,
        });

      expect(res2.status).toBe(409);
      expect(res2.body.error).toBe("Overlapping departure detected for this driver or vehicle");
    }, 60000);

    it("while a trip is active, arriving at a second departure is rejected (409) even though its scheduled time has passed", async () => {
      // Create departure A (active) and departure B (non-overlapping)
      const timeA = new Date(Date.now() + 120 * 3600 * 1000).toISOString();
      const resA = await request(app)
        .post("/departures")
        .set("Authorization", `Bearer ${enabledDriverToken}`)
        .send({
          vehicleId: soloVehicle.id,
          routeId: activeRoute.id,
          mode: "SOLO",
          departureTime: timeA,
        });
      expect(resA.status).toBe(201);
      const depAId = resA.body.departureId;

      const timeB = new Date(Date.now() + 125 * 3600 * 1000).toISOString();
      const resB = await request(app)
        .post("/departures")
        .set("Authorization", `Bearer ${enabledDriverToken}`)
        .send({
          vehicleId: soloVehicle.id,
          routeId: activeRoute.id,
          mode: "SOLO",
          departureTime: timeB,
        });
      expect(resB.status).toBe(201);
      const depBId = resB.body.departureId;

      // Driver arrives at departure A -> Trip is now active (ARRIVED)
      const arriveA = await request(app)
        .post(`/departures/${depAId}/arrive`)
        .set("Authorization", `Bearer ${enabledDriverToken}`);
      expect(arriveA.status).toBe(200);

      // Set departure B's scheduled time into the past directly in the database
      const departureRepo = AppDataSource.getRepository(Departure);
      await departureRepo.update(depBId, {
        departure_time: new Date(Date.now() - 3600 * 1000), // 1 hour ago
      });

      // Attempt to arrive at departure B while departure A is active -> rejected 409
      const arriveB = await request(app)
        .post(`/departures/${depBId}/arrive`)
        .set("Authorization", `Bearer ${enabledDriverToken}`);

      expect(arriveB.status).toBe(409);
      expect(arriveB.body.error).toBe("You already have a trip in progress");

      // Complete departure A to cleanup driver active state
      await request(app)
        .post(`/departures/${depAId}/depart`)
        .set("Authorization", `Bearer ${enabledDriverToken}`);
      await request(app)
        .post(`/departures/${depAId}/complete`)
        .set("Authorization", `Bearer ${enabledDriverToken}`);
    }, 60000);
  });

  describe("Scenario e: Publishing rules through POST /departures", () => {
    it("a disabled driver gets 403", async () => {
      const res = await request(app)
        .post("/departures")
        .set("Authorization", `Bearer ${disabledDriverToken}`)
        .send({
          vehicleId: soloVehicle.id,
          routeId: activeRoute.id,
          mode: "SOLO",
          departureTime: new Date(Date.now() + 144 * 3600 * 1000).toISOString(),
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Driver is not enabled to publish departures");
    }, 60000);

    it("a driver using another driver's vehicle gets 403", async () => {
      const res = await request(app)
        .post("/departures")
        .set("Authorization", `Bearer ${enabledDriverToken}`)
        .send({
          vehicleId: secondDriverVehicle.id,
          routeId: activeRoute.id,
          mode: "SOLO",
          departureTime: new Date(Date.now() + 144 * 3600 * 1000).toISOString(),
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Vehicle does not belong to driver");
    }, 60000);

    it("a missing or invalid field gets 400", async () => {
      // Invalid mode and malformed vehicleId
      const res = await request(app)
        .post("/departures")
        .set("Authorization", `Bearer ${enabledDriverToken}`)
        .send({
          vehicleId: "not-a-valid-uuid",
          routeId: activeRoute.id,
          mode: "INVALID_MODE",
          departureTime: "not-a-date",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
    }, 60000);

    it("an unknown or inactive route gets 404", async () => {
      // Unknown route
      const resUnknown = await request(app)
        .post("/departures")
        .set("Authorization", `Bearer ${enabledDriverToken}`)
        .send({
          vehicleId: soloVehicle.id,
          routeId: crypto.randomUUID(),
          mode: "SOLO",
          departureTime: new Date(Date.now() + 144 * 3600 * 1000).toISOString(),
        });

      expect(resUnknown.status).toBe(404);
      expect(resUnknown.body.error).toBe("Route not found");

      // Inactive route
      const resInactive = await request(app)
        .post("/departures")
        .set("Authorization", `Bearer ${enabledDriverToken}`)
        .send({
          vehicleId: soloVehicle.id,
          routeId: inactiveRoute.id,
          mode: "SOLO",
          departureTime: new Date(Date.now() + 144 * 3600 * 1000).toISOString(),
        });

      expect(resInactive.status).toBe(404);
      expect(resInactive.body.error).toBe("Route not found");
    }, 60000);

    it("an overlap for the same driver gets 409 and an overlap for the same vehicle (different driver) gets 409", async () => {
      const baseTime = new Date(Date.now() + 160 * 3600 * 1000);

      // 1. Same driver overlap with different vehicles
      const dep1 = await request(app)
        .post("/departures")
        .set("Authorization", `Bearer ${enabledDriverToken}`)
        .send({
          vehicleId: soloVehicle.id,
          routeId: activeRoute.id,
          mode: "SOLO",
          departureTime: baseTime.toISOString(),
        });
      expect(dep1.status).toBe(201);

      const depSameDriverOverlap = await request(app)
        .post("/departures")
        .set("Authorization", `Bearer ${enabledDriverToken}`)
        .send({
          vehicleId: pooledVehicle3.id,
          routeId: activeRoute.id,
          mode: "POOLED",
          departureTime: new Date(baseTime.getTime() + 15 * 60 * 1000).toISOString(),
        });
      expect(depSameDriverOverlap.status).toBe(409);
      expect(depSameDriverOverlap.body.error).toBe(
        "Overlapping departure detected for this driver or vehicle"
      );

      // 2. Same vehicle overlap with different driver
      // Create a vehicle initially belonging to Driver 1
      const vehicleRepo = AppDataSource.getRepository(Vehicle);
      const sharedVehicle = await vehicleRepo.save(
        vehicleRepo.create({
          driver_id: enabledDriver.id,
          description: "Vehicle to transfer",
          registration_identifier: `SHARED-${Date.now()}`,
          seat_capacity: 4,
          active: true,
        })
      );

      const vehicleTime = new Date(Date.now() + 180 * 3600 * 1000);
      const depVehicle1 = await request(app)
        .post("/departures")
        .set("Authorization", `Bearer ${enabledDriverToken}`)
        .send({
          vehicleId: sharedVehicle.id,
          routeId: activeRoute.id,
          mode: "POOLED",
          departureTime: vehicleTime.toISOString(),
        });
      expect(depVehicle1.status).toBe(201);

      // Reassign vehicle ownership to Driver 2 in the database
      await vehicleRepo.update(sharedVehicle.id, { driver_id: secondDriver.id });

      // Driver 2 attempts to publish an overlapping departure with the same vehicle
      const depDiffDriverSameVehicle = await request(app)
        .post("/departures")
        .set("Authorization", `Bearer ${secondDriverToken}`)
        .send({
          vehicleId: sharedVehicle.id,
          routeId: activeRoute.id,
          mode: "POOLED",
          departureTime: new Date(vehicleTime.getTime() + 15 * 60 * 1000).toISOString(),
        });

      expect(depDiffDriverSameVehicle.status).toBe(409);
      expect(depDiffDriverSameVehicle.body.error).toBe(
        "Overlapping departure detected for this driver or vehicle"
      );
    }, 60000);

    it("a back-to-back departure starting exactly when the first ends gets 201", async () => {
      const baseTime = new Date(Date.now() + 200 * 3600 * 1000);
      // First departure: starts at baseTime, duration is 45 mins
      const res1 = await request(app)
        .post("/departures")
        .set("Authorization", `Bearer ${enabledDriverToken}`)
        .send({
          vehicleId: soloVehicle.id,
          routeId: activeRoute.id,
          mode: "SOLO",
          departureTime: baseTime.toISOString(),
        });
      expect(res1.status).toBe(201);

      // Second departure: starts exactly at baseTime + 45 minutes
      const exactEndTime = new Date(baseTime.getTime() + 45 * 60 * 1000).toISOString();
      const res2 = await request(app)
        .post("/departures")
        .set("Authorization", `Bearer ${enabledDriverToken}`)
        .send({
          vehicleId: soloVehicle.id,
          routeId: activeRoute.id,
          mode: "SOLO",
          departureTime: exactEndTime,
        });

      expect(res2.status).toBe(201);
      expect(res2.body.status).toBe("SCHEDULED");
      expect(res2.body.departureId).toBeDefined();
    }, 60000);
  });
});
