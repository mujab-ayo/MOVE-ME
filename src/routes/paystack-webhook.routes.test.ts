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
import { Payment, PaymentStatus } from "../entities/payment.entity";
import { Notification } from "../entities/notification.entity";
import { toKobo } from "../services/paystack.client";

dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env", quiet: true });

describe("Paystack Webhook & Confirmation Flow (src/routes/paystack-webhook.routes.test.ts)", () => {
  const secret = process.env.JWT_SECRET || "ride_pooling_capstone_dev_secret_key_2026";
  const originalEnv = { ...process.env };

  let driver: User;
  let passenger: User;
  let driverToken: string;
  let passengerToken: string;
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
        email: "pwh_driver@test.com",
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    passenger = await userRepo.save(
      userRepo.create({
        email: "pwh_passenger@test.com",
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    driverToken = jwt.sign({ sub: driver.id, role: driver.role }, secret);
    passengerToken = jwt.sign({ sub: passenger.id, role: passenger.role }, secret);

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
        registration_identifier: "PWH-VEH-101",
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

    const paymentRepo = AppDataSource.getRepository(Payment);
    const reservationRepo = AppDataSource.getRepository(Reservation);

    await paymentRepo.createQueryBuilder().delete().execute();
    await reservationRepo.createQueryBuilder().delete().execute();

    await AppDataSource.query(`UPDATE departures SET status = 'SCHEDULED' WHERE id = $1;`, [
      testDeparture.id,
    ]);
  });

  afterEach(() => {
    restoreEnv();
  });

  function computeSignature(payload: string | object, secret = "sk_test_unit"): string {
    const bodyStr = typeof payload === "string" ? payload : JSON.stringify(payload);
    return crypto.createHmac("sha512", secret).update(bodyStr).digest("hex");
  }

  async function createFixture(params?: {
    fareAmount?: string;
    holdExpiresAt?: Date;
    departureStatus?: string;
    provider?: "PAYSTACK" | "SIMULATED";
    paymentStatus?: PaymentStatus;
  }) {
    const reservationRepo = AppDataSource.getRepository(Reservation);
    const paymentRepo = AppDataSource.getRepository(Payment);

    const fare = params?.fareAmount || "3000.00";
    const holdExpiresAt = params?.holdExpiresAt || new Date(Date.now() + 15 * 60 * 1000);
    const provider = params?.provider || "PAYSTACK";

    if (params?.departureStatus) {
      await AppDataSource.query(`UPDATE departures SET status = $1 WHERE id = $2;`, [
        params.departureStatus,
        testDeparture.id,
      ]);
    }

    const reservation = await reservationRepo.save(
      reservationRepo.create({
        departure_id: testDeparture.id,
        passenger_id: passenger.id,
        status: "PENDING_PAYMENT",
        fare_amount: fare,
        hold_expires_at: holdExpiresAt,
      })
    );

    const reference = provider === "PAYSTACK" ? `mm_${crypto.randomUUID()}` : null;
    const payment = await paymentRepo.save(
      paymentRepo.create({
        reservation_id: reservation.id,
        amount: fare,
        status: params?.paymentStatus || "PENDING",
        idempotency_key: crypto.randomUUID(),
        provider,
        provider_reference: reference,
      })
    );

    return { reservation, payment };
  }

  it("a wrong signature gives 401 and the reservation stays PENDING_PAYMENT", async () => {
    const { reservation, payment } = await createFixture();

    const payload = {
      event: "charge.success",
      data: {
        status: "success",
        reference: payment.provider_reference,
        amount: toKobo(payment.amount),
        currency: "NGN",
      },
    };
    const rawBody = JSON.stringify(payload);

    const res = await request(app)
      .post("/webhooks/paystack")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", "wrong_signature_hex_value_1234567890abcdef")
      .send(rawBody);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid signature");

    const reservationRepo = AppDataSource.getRepository(Reservation);
    const dbReservation = await reservationRepo.findOne({ where: { id: reservation.id } });
    expect(dbReservation?.status).toBe("PENDING_PAYMENT");
  });

  it("a missing signature gives 401", async () => {
    const { payment } = await createFixture();

    const payload = {
      event: "charge.success",
      data: {
        status: "success",
        reference: payment.provider_reference,
        amount: toKobo(payment.amount),
        currency: "NGN",
      },
    };

    const res = await request(app)
      .post("/webhooks/paystack")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(payload));

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid signature");
  });

  it("a valid charge.success confirms (payment SUCCEEDED, reservation CONFIRMED)", async () => {
    const { reservation, payment } = await createFixture();

    const payload = {
      event: "charge.success",
      data: {
        status: "success",
        reference: payment.provider_reference,
        amount: toKobo(payment.amount),
        currency: "NGN",
      },
    };
    const rawBody = JSON.stringify(payload);
    const signature = computeSignature(rawBody);

    const res = await request(app)
      .post("/webhooks/paystack")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const paymentRepo = AppDataSource.getRepository(Payment);
    const reservationRepo = AppDataSource.getRepository(Reservation);

    const dbPayment = await paymentRepo.findOne({ where: { id: payment.id } });
    expect(dbPayment?.status).toBe("SUCCEEDED");
    expect(dbPayment?.completed_at).not.toBeNull();

    const dbReservation = await reservationRepo.findOne({ where: { id: reservation.id } });
    expect(dbReservation?.status).toBe("CONFIRMED");
  });

  it("the same event delivered twice gives 200 both times with exactly one SUCCEEDED payment", async () => {
    const { reservation, payment } = await createFixture();

    const payload = {
      event: "charge.success",
      data: {
        status: "success",
        reference: payment.provider_reference,
        amount: toKobo(payment.amount),
        currency: "NGN",
      },
    };
    const rawBody = JSON.stringify(payload);
    const signature = computeSignature(rawBody);

    // Delivery 1
    const res1 = await request(app)
      .post("/webhooks/paystack")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(rawBody);

    expect(res1.status).toBe(200);
    expect(res1.body.received).toBe(true);

    // Delivery 2 (duplicate)
    const res2 = await request(app)
      .post("/webhooks/paystack")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(rawBody);

    expect(res2.status).toBe(200);
    expect(res2.body.received).toBe(true);

    const paymentRepo = AppDataSource.getRepository(Payment);
    const succeededCount = await paymentRepo.count({
      where: { reservation_id: reservation.id, status: "SUCCEEDED" },
    });
    expect(succeededCount).toBe(1);
  });

  it("two identical events at the same moment leave exactly one SUCCEEDED payment", async () => {
    const { reservation, payment } = await createFixture();

    const payload = {
      event: "charge.success",
      data: {
        status: "success",
        reference: payment.provider_reference,
        amount: toKobo(payment.amount),
        currency: "NGN",
      },
    };
    const rawBody = JSON.stringify(payload);
    const signature = computeSignature(rawBody);

    const sendEvent = () =>
      request(app)
        .post("/webhooks/paystack")
        .set("Content-Type", "application/json")
        .set("x-paystack-signature", signature)
        .send(rawBody);

    const [resA, resB] = await Promise.all([sendEvent(), sendEvent()]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const paymentRepo = AppDataSource.getRepository(Payment);
    const succeededCount = await paymentRepo.count({
      where: { reservation_id: reservation.id, status: "SUCCEEDED" },
    });
    expect(succeededCount).toBe(1);
  });

  it("an amount mismatch is ignored", async () => {
    const { reservation, payment } = await createFixture();

    const payload = {
      event: "charge.success",
      data: {
        status: "success",
        reference: payment.provider_reference,
        amount: 999999, // Mismatched amount
        currency: "NGN",
      },
    };
    const rawBody = JSON.stringify(payload);
    const signature = computeSignature(rawBody);

    const res = await request(app)
      .post("/webhooks/paystack")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const paymentRepo = AppDataSource.getRepository(Payment);
    const reservationRepo = AppDataSource.getRepository(Reservation);

    const dbPayment = await paymentRepo.findOne({ where: { id: payment.id } });
    expect(dbPayment?.status).toBe("PENDING");

    const dbReservation = await reservationRepo.findOne({ where: { id: reservation.id } });
    expect(dbReservation?.status).toBe("PENDING_PAYMENT");
  });

  it("an unknown reference is ignored with 200", async () => {
    const payload = {
      event: "charge.success",
      data: {
        status: "success",
        reference: "mm_unknown_reference_that_does_not_exist",
        amount: 300000,
        currency: "NGN",
      },
    };
    const rawBody = JSON.stringify(payload);
    const signature = computeSignature(rawBody);

    const res = await request(app)
      .post("/webhooks/paystack")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it("a late event after the hold expired leaves payment REFUND_PENDING and reservation EXPIRED, never CONFIRMED", async () => {
    // Hold expired 1 minute ago
    const expiredTime = new Date(Date.now() - 60 * 1000);
    const { reservation, payment } = await createFixture({ holdExpiresAt: expiredTime });

    const payload = {
      event: "charge.success",
      data: {
        status: "success",
        reference: payment.provider_reference,
        amount: toKobo(payment.amount),
        currency: "NGN",
      },
    };
    const rawBody = JSON.stringify(payload);
    const signature = computeSignature(rawBody);

    const res = await request(app)
      .post("/webhooks/paystack")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(rawBody);

    expect(res.status).toBe(200);

    const paymentRepo = AppDataSource.getRepository(Payment);
    const reservationRepo = AppDataSource.getRepository(Reservation);

    const dbPayment = await paymentRepo.findOne({ where: { id: payment.id } });
    expect(dbPayment?.status).toBe("REFUND_PENDING");

    const dbReservation = await reservationRepo.findOne({ where: { id: reservation.id } });
    expect(dbReservation?.status).toBe("EXPIRED");

    const confirmedCount = await reservationRepo.count({
      where: { id: reservation.id, status: "CONFIRMED" },
    });
    expect(confirmedCount).toBe(0);
  });

  it("an event after the departure went IN_PROGRESS or CANCELLED is ignored the same way", async () => {
    // 1. Departure is IN_PROGRESS
    const fixture1 = await createFixture({ departureStatus: "IN_PROGRESS" });

    const payload1 = {
      event: "charge.success",
      data: {
        status: "success",
        reference: fixture1.payment.provider_reference,
        amount: toKobo(fixture1.payment.amount),
        currency: "NGN",
      },
    };
    const rawBody1 = JSON.stringify(payload1);
    const signature1 = computeSignature(rawBody1);

    const res1 = await request(app)
      .post("/webhooks/paystack")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature1)
      .send(rawBody1);

    expect(res1.status).toBe(200);

    const paymentRepo = AppDataSource.getRepository(Payment);
    const reservationRepo = AppDataSource.getRepository(Reservation);

    const dbPayment1 = await paymentRepo.findOne({ where: { id: fixture1.payment.id } });
    expect(dbPayment1?.status).toBe("REFUND_PENDING");

    const dbReservation1 = await reservationRepo.findOne({ where: { id: fixture1.reservation.id } });
    expect(dbReservation1?.status).toBe("EXPIRED");

    // 2. Departure is CANCELLED
    const fixture2 = await createFixture({ departureStatus: "CANCELLED" });

    const payload2 = {
      event: "charge.success",
      data: {
        status: "success",
        reference: fixture2.payment.provider_reference,
        amount: toKobo(fixture2.payment.amount),
        currency: "NGN",
      },
    };
    const rawBody2 = JSON.stringify(payload2);
    const signature2 = computeSignature(rawBody2);

    const res2 = await request(app)
      .post("/webhooks/paystack")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature2)
      .send(rawBody2);

    expect(res2.status).toBe(200);

    const dbPayment2 = await paymentRepo.findOne({ where: { id: fixture2.payment.id } });
    expect(dbPayment2?.status).toBe("REFUND_PENDING");

    const dbReservation2 = await reservationRepo.findOne({ where: { id: fixture2.reservation.id } });
    expect(dbReservation2?.status).toBe("EXPIRED");
  });

  it("an unrelated event type gets 200 and changes nothing", async () => {
    const { reservation, payment } = await createFixture();

    const payload = {
      event: "transfer.success",
      data: {
        reference: payment.provider_reference,
      },
    };
    const rawBody = JSON.stringify(payload);
    const signature = computeSignature(rawBody);

    const res = await request(app)
      .post("/webhooks/paystack")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const paymentRepo = AppDataSource.getRepository(Payment);
    const reservationRepo = AppDataSource.getRepository(Reservation);

    const dbPayment = await paymentRepo.findOne({ where: { id: payment.id } });
    expect(dbPayment?.status).toBe("PENDING");

    const dbReservation = await reservationRepo.findOne({ where: { id: reservation.id } });
    expect(dbReservation?.status).toBe("PENDING_PAYMENT");
  });

  it("the simulated callback on a PAYSTACK payment gets 403", async () => {
    const { payment } = await createFixture({ provider: "PAYSTACK" });

    const res = await request(app)
      .post(`/payments/${payment.id}/callback`)
      .send({ outcome: "SUCCESS" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("This payment is confirmed by the payment provider only");
  });

  it("a SIMULATED payment cannot be confirmed through the webhook", async () => {
    const { reservation, payment } = await createFixture({ provider: "SIMULATED" });

    const payload = {
      event: "charge.success",
      data: {
        status: "success",
        reference: payment.idempotency_key,
        amount: toKobo(payment.amount),
        currency: "NGN",
      },
    };
    const rawBody = JSON.stringify(payload);
    const signature = computeSignature(rawBody);

    const res = await request(app)
      .post("/webhooks/paystack")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(rawBody);

    expect(res.status).toBe(200);

    const paymentRepo = AppDataSource.getRepository(Payment);
    const reservationRepo = AppDataSource.getRepository(Reservation);

    const dbPayment = await paymentRepo.findOne({ where: { id: payment.id } });
    expect(dbPayment?.status).toBe("PENDING");

    const dbReservation = await reservationRepo.findOne({ where: { id: reservation.id } });
    expect(dbReservation?.status).toBe("PENDING_PAYMENT");
  });

  it("with NODE_ENV forced to \"production\" the simulated callback gets 404", async () => {
    process.env.NODE_ENV = "production";
    const { payment } = await createFixture({ provider: "SIMULATED" });

    const res = await request(app)
      .post(`/payments/${payment.id}/callback`)
      .send({ outcome: "SUCCESS" });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Not found");
  });
});
