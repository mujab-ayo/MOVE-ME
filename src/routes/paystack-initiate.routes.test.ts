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
import { Notification } from "../entities/notification.entity";
import { toKobo } from "../services/paystack.client";

dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env", quiet: true });

describe("Paystack Initiation & Payment Flow (src/routes/paystack-initiate.routes.test.ts)", () => {
  const secret = process.env.JWT_SECRET || "ride_pooling_capstone_dev_secret_key_2026";
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

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

    driver = await userRepo.save(
      userRepo.create({
        email: "ps_driver@test.com",
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    passengerA = await userRepo.save(
      userRepo.create({
        email: "ps_passenger_a@test.com",
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    passengerB = await userRepo.save(
      userRepo.create({
        email: "ps_passenger_b@test.com",
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
        registration_identifier: "PS-VEH-101",
        seat_capacity: 4,
        active: true,
      })
    );

    testDeparture = await departureRepo.save(
      departureRepo.create({
        driver_id: driver.id,
        vehicle_id: testVehicle.id,
        route_id: testRoute.id,
        mode: "POOLED",
        departure_time: new Date(Date.now() + 24 * 60 * 60 * 1000),
        duration_minutes: 45,
        fare_amount: "3000.00",
        capacity: 4,
        status: "SCHEDULED",
      })
    );
  }, 60000);

  afterAll(async () => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };

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

  function restoreEnv(): void {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value !== undefined) {
        process.env[key] = value;
      }
    }
    process.env.NODE_ENV = originalEnv.NODE_ENV || "test";
  }

  afterEach(() => {
    restoreEnv();
  });

  afterAll(() => {
    restoreEnv();
  });

  beforeEach(async () => {
    restoreEnv();
    process.env.PAYSTACK_SECRET_KEY = "sk_test_unit";
    process.env.PUBLIC_BASE_URL = "http://localhost:3000";

    const paymentRepo = AppDataSource.getRepository(Payment);
    const reservationRepo = AppDataSource.getRepository(Reservation);

    await paymentRepo.createQueryBuilder().delete().execute();
    await reservationRepo.createQueryBuilder().delete().execute();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    restoreEnv();
  });

  // Helper to create an active reservation for passengerA
  async function createActiveReservation(fareAmount = "3000.00", passenger = passengerA): Promise<Reservation> {
    const reservationRepo = AppDataSource.getRepository(Reservation);
    return await reservationRepo.save(
      reservationRepo.create({
        departure_id: testDeparture.id,
        passenger_id: passenger.id,
        status: "PENDING_PAYMENT",
        fare_amount: fareAmount,
        hold_expires_at: new Date(Date.now() + 15 * 60 * 1000), // 15 mins in future
      })
    );
  }

  describe("toKobo unit tests", () => {
    it("converts '7500.00' to 750000", () => {
      expect(toKobo("7500.00")).toBe(750000);
    });

    it("converts '2500.5' to 250050", () => {
      expect(toKobo("2500.5")).toBe(250050);
    });

    it("converts '0.05' to 5", () => {
      expect(toKobo("0.05")).toBe(5);
    });

    it("rejects a three-decimal input", () => {
      expect(() => toKobo("100.123")).toThrow("Amount cannot have more than two decimal places");
      expect(() => toKobo("7500.005")).toThrow();
    });
  });

  describe("Paystack initiation tests", () => {
    it("a PAYSTACK payment returns 201 with checkoutUrl, and the fake received the right amount in kobo, email, reference and Bearer header", async () => {
      const reservation = await createActiveReservation("3000.00");

      let capturedUrl = "";
      let capturedOptions: any;

      global.fetch = jest.fn(async (url: any, options: any) => {
        capturedUrl = String(url);
        capturedOptions = options;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: true,
            message: "Authorization URL created",
            data: {
              authorization_url: "https://checkout.paystack.com/fake_checkout_12345",
              reference: "mm_fake_ref",
            },
          }),
        } as Response;
      });

      const res = await request(app)
        .post(`/reservations/${reservation.id}/payments`)
        .set("Authorization", `Bearer ${passengerAToken}`)
        .send({ provider: "PAYSTACK" });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("PENDING");
      expect(res.body.provider).toBe("PAYSTACK");
      expect(res.body.checkoutUrl).toBe("https://checkout.paystack.com/fake_checkout_12345");
      expect(res.body.paymentId).toBeDefined();
      expect(res.body.reference).toBeDefined();
      expect(res.body.reference.startsWith("mm_")).toBe(true);

      // Verify fake fetch received correct data
      expect(capturedUrl).toBe("https://api.paystack.co/transaction/initialize");
      expect(capturedOptions.method).toBe("POST");
      expect(capturedOptions.headers["Authorization"]).toBe("Bearer sk_test_unit");
      expect(capturedOptions.headers["Content-Type"]).toBe("application/json");

      const parsedBody = JSON.parse(capturedOptions.body);
      expect(parsedBody.email).toBe(passengerA.email);
      expect(parsedBody.amount).toBe(300000);
      expect(parsedBody.reference).toBe(res.body.reference);
      expect(parsedBody.callback_url).toBe("http://localhost:3000/payments/return");
      expect(parsedBody.currency).toBe("NGN");
    });

    it("a live key (sk_live_x) gives 503", async () => {
      process.env.PAYSTACK_SECRET_KEY = "sk_live_abcdef123456";
      const reservation = await createActiveReservation();

      const res = await request(app)
        .post(`/reservations/${reservation.id}/payments`)
        .set("Authorization", `Bearer ${passengerAToken}`)
        .send({ provider: "PAYSTACK" });

      expect(res.status).toBe(503);
      expect(res.body.error).toBe("Paystack is not configured");
    });

    it("a missing key gives 503", async () => {
      delete process.env.PAYSTACK_SECRET_KEY;
      const reservation = await createActiveReservation();

      const res = await request(app)
        .post(`/reservations/${reservation.id}/payments`)
        .set("Authorization", `Bearer ${passengerAToken}`)
        .send({ provider: "PAYSTACK" });

      expect(res.status).toBe(503);
      expect(res.body.error).toBe("Paystack is not configured");
    });

    it("the fake failing gives 502 with the payment FAILED and the reservation still PENDING_PAYMENT", async () => {
      const reservation = await createActiveReservation();

      global.fetch = jest.fn(async () => {
        return {
          ok: false,
          status: 500,
          json: async () => ({ status: false, message: "Gateway error" }),
        } as Response;
      });

      const res = await request(app)
        .post(`/reservations/${reservation.id}/payments`)
        .set("Authorization", `Bearer ${passengerAToken}`)
        .send({ provider: "PAYSTACK" });

      expect(res.status).toBe(502);
      expect(res.body.error).toBe("Payment provider unavailable");

      // Verify payment was marked FAILED
      const paymentRepo = AppDataSource.getRepository(Payment);
      const payment = await paymentRepo.findOne({
        where: { reservation_id: reservation.id },
      });
      expect(payment).not.toBeNull();
      expect(payment?.status).toBe("FAILED");
      expect(payment?.provider).toBe("PAYSTACK");

      // Verify reservation is still PENDING_PAYMENT (not cancelled, not expired)
      const reservationRepo = AppDataSource.getRepository(Reservation);
      const updatedReservation = await reservationRepo.findOne({
        where: { id: reservation.id },
      });
      expect(updatedReservation?.status).toBe("PENDING_PAYMENT");
    });

    it("an invalid provider value gives 400", async () => {
      const reservation = await createActiveReservation();

      const res = await request(app)
        .post(`/reservations/${reservation.id}/payments`)
        .set("Authorization", `Bearer ${passengerAToken}`)
        .send({ provider: "STRIPE" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid payment provider");
    });

    it("with NODE_ENV forced to \"production\" and ALLOW_SIMULATED_PAYMENTS \"true\", requesting SIMULATED gives 400 and no body gives PAYSTACK", async () => {
      process.env.NODE_ENV = "production";
      process.env.ALLOW_SIMULATED_PAYMENTS = "true";
      const reservation = await createActiveReservation();

      // 1. Explicitly requesting SIMULATED -> 400
      const resSimulated = await request(app)
        .post(`/reservations/${reservation.id}/payments`)
        .set("Authorization", `Bearer ${passengerAToken}`)
        .send({ provider: "SIMULATED" });

      expect(resSimulated.status).toBe(400);
      expect(resSimulated.body.error).toBe("Simulated payments are disabled");

      // 2. No body -> defaultProvider() resolves to PAYSTACK
      global.fetch = jest.fn(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: true,
            data: {
              authorization_url: "https://checkout.paystack.com/prod_checkout_url",
            },
          }),
        } as Response;
      });

      const resNoBody = await request(app)
        .post(`/reservations/${reservation.id}/payments`)
        .set("Authorization", `Bearer ${passengerAToken}`)
        .send({});

      expect(resNoBody.status).toBe(201);
      expect(resNoBody.body.provider).toBe("PAYSTACK");
      expect(resNoBody.body.checkoutUrl).toBe("https://checkout.paystack.com/prod_checkout_url");
    });

    it("a SIMULATED payment with no body still works under NODE_ENV=test", async () => {
      process.env.NODE_ENV = "test";
      const reservation = await createActiveReservation();

      const res = await request(app)
        .post(`/reservations/${reservation.id}/payments`)
        .set("Authorization", `Bearer ${passengerAToken}`)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("PENDING");
      expect(res.body.paymentId).toBeDefined();

      const paymentRepo = AppDataSource.getRepository(Payment);
      const payment = await paymentRepo.findOne({
        where: { id: res.body.paymentId },
      });
      expect(payment?.provider).toBe("SIMULATED");
      expect(payment?.status).toBe("PENDING");
    });

    it("another passenger gets 403", async () => {
      const reservation = await createActiveReservation("3000.00", passengerA);

      const res = await request(app)
        .post(`/reservations/${reservation.id}/payments`)
        .set("Authorization", `Bearer ${passengerBToken}`)
        .send({ provider: "PAYSTACK" });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Forbidden: not your reservation");
    });
  });

  describe("GET /payments/return", () => {
    it("returns public HTML landing page without modifying data", async () => {
      const res = await request(app).get("/payments/return");

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.text).toContain("Payment Submitted");
      expect(res.text).toContain("booking is confirmed when the payment provider notifies the server");
      expect(res.text).toContain("/app/");
    });
  });
});
