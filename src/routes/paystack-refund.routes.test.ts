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
import { Payment, PaymentStatus, PaymentProvider } from "../entities/payment.entity";
import { Notification } from "../entities/notification.entity";
import { toKobo } from "../services/paystack.client";

dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env", quiet: true });

describe("Paystack Refund Lifecycle (src/routes/paystack-refund.routes.test.ts)", () => {
  const secret = process.env.JWT_SECRET || "ride_pooling_capstone_dev_secret_key_2026";
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  let driver: User;
  let driverToken: string;
  let testRoute: Route;
  let testVehicle: Vehicle;
  let testDeparture: Departure;

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

  function computeSignature(payload: string | object, secretKey = "sk_test_unit"): string {
    const bodyStr = typeof payload === "string" ? payload : JSON.stringify(payload);
    return crypto.createHmac("sha512", secretKey).update(bodyStr).digest("hex");
  }

  async function waitForPayment(
    paymentId: string,
    predicate: (p: Payment) => boolean,
    timeoutMs = 5000
  ): Promise<Payment> {
    const paymentRepo = AppDataSource.getRepository(Payment);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const p = await paymentRepo.findOne({ where: { id: paymentId } });
      if (p && predicate(p)) {
        return p;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    const finalCheck = await paymentRepo.findOne({ where: { id: paymentId } });
    if (!finalCheck || !predicate(finalCheck)) {
      throw new Error(
        `Timed out waiting for payment condition on ${paymentId}. Current status: ${finalCheck?.status}, error: ${finalCheck?.refund_error}`
      );
    }
    return finalCheck;
  }

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
        email: "paystack_ref_driver@test.com",
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );
    driverToken = jwt.sign({ sub: driver.id, role: driver.role }, secret);

    testRoute = await routeRepo.save(
      routeRepo.create({
        pickup_point: "Refund Marina Terminal",
        dropoff_point: "Refund Ikeja Bus Station",
        base_duration_minutes: 45,
        base_fare_solo: "7000.00",
        base_fare_per_seat: "3500.00",
        active: true,
      })
    );

    testVehicle = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: driver.id,
        description: "Toyota Hiace",
        registration_identifier: "PAY-REF-101",
        seat_capacity: 6,
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
        fare_amount: "3500.00",
        capacity: 6,
        status: "SCHEDULED",
      })
    );
  }, 60000);

  afterAll(async () => {
    global.fetch = originalFetch;
    restoreEnv();

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
    restoreEnv();
    process.env.PAYSTACK_SECRET_KEY = "sk_test_unit";

    const notificationRepo = AppDataSource.getRepository(Notification);
    const paymentRepo = AppDataSource.getRepository(Payment);
    const reservationRepo = AppDataSource.getRepository(Reservation);

    await notificationRepo.createQueryBuilder().delete().execute();
    await paymentRepo.createQueryBuilder().delete().execute();
    await reservationRepo.createQueryBuilder().delete().execute();

    await AppDataSource.query(`UPDATE departures SET status = 'SCHEDULED' WHERE id = $1;`, [
      testDeparture.id,
    ]);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    restoreEnv();
  });

  async function createPaidReservationFixture(options?: {
    provider?: PaymentProvider;
    paymentStatus?: PaymentStatus;
    reservationStatus?: string;
    holdExpiresAt?: Date;
    fareAmount?: string;
    providerReference?: string;
  }) {
    const userRepo = AppDataSource.getRepository(User);
    const reservationRepo = AppDataSource.getRepository(Reservation);
    const paymentRepo = AppDataSource.getRepository(Payment);

    const passenger = await userRepo.save(
      userRepo.create({
        email: `p_ref_${crypto.randomUUID()}@test.com`,
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );
    const passengerToken = jwt.sign({ sub: passenger.id, role: passenger.role }, secret);

    const fare = options?.fareAmount ?? "3500.00";
    const provider: PaymentProvider = options?.provider ?? "PAYSTACK";
    const paymentStatus: PaymentStatus = options?.paymentStatus ?? "SUCCEEDED";
    const reservationStatus = options?.reservationStatus ?? "CONFIRMED";
    const holdExpiresAt = options?.holdExpiresAt ?? new Date(Date.now() + 15 * 60 * 1000);

    const reservation = await reservationRepo.save(
      reservationRepo.create({
        departure_id: testDeparture.id,
        passenger_id: passenger.id,
        status: reservationStatus as any,
        fare_amount: fare,
        hold_expires_at: holdExpiresAt,
      })
    );

    const reference =
      options?.providerReference ??
      (provider === "PAYSTACK" ? `mm_${crypto.randomUUID()}` : null);

    const payment = await paymentRepo.save(
      paymentRepo.create({
        reservation_id: reservation.id,
        amount: fare,
        status: paymentStatus,
        provider,
        provider_reference: reference,
        idempotency_key: crypto.randomUUID(),
        completed_at: paymentStatus === "SUCCEEDED" ? new Date() : null,
      })
    );

    return { passenger, passengerToken, reservation, payment };
  }

  it("passenger cancel of a paid PAYSTACK reservation leaves REFUND_PENDING, then the fake receives exactly one refund request and the payment becomes REFUNDED when the fake answers processed", async () => {
    const { passengerToken, reservation, payment } = await createPaidReservationFixture({
      provider: "PAYSTACK",
      paymentStatus: "SUCCEEDED",
      reservationStatus: "CONFIRMED",
    });

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: true,
        data: { id: "ref_processed_1", status: "processed" },
      }),
    });
    global.fetch = fetchMock;

    const res = await request(app)
      .post(`/reservations/${reservation.id}/cancel`)
      .set("Authorization", `Bearer ${passengerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");
    expect(res.body.refund).toMatchObject({
      simulated: false,
      status: "PENDING",
      paymentId: payment.id,
    });

    // Wait for the background refund work to complete
    const updated = await waitForPayment(payment.id, (p) => p.status === "REFUNDED");
    expect(updated.status).toBe("REFUNDED");
    expect(updated.refunded_at).not.toBeNull();
    expect(updated.provider_refund_id).toBe("ref_processed_1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("the same with a pending answer followed by a signed refund.processed event", async () => {
    const { passengerToken, reservation, payment } = await createPaidReservationFixture({
      provider: "PAYSTACK",
      paymentStatus: "SUCCEEDED",
      reservationStatus: "CONFIRMED",
    });

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: true,
        data: { id: "ref_pending_2", status: "pending" },
      }),
    });
    global.fetch = fetchMock;

    const res = await request(app)
      .post(`/reservations/${reservation.id}/cancel`)
      .set("Authorization", `Bearer ${passengerToken}`);

    expect(res.status).toBe(200);

    // Wait until initial requestRefund stores the pending refund id and keeps REFUND_PENDING
    await waitForPayment(
      payment.id,
      (p) => p.provider_refund_id === "ref_pending_2" && p.status === "REFUND_PENDING"
    );

    // Now Paystack delivers refund.processed webhook
    const webhookPayload = {
      event: "refund.processed",
      data: {
        id: "ref_pending_2",
        transaction_reference: payment.provider_reference,
        status: "processed",
      },
    };
    const rawBody = JSON.stringify(webhookPayload);
    const signature = computeSignature(rawBody);

    const webhookRes = await request(app)
      .post("/webhooks/paystack")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(rawBody);

    expect(webhookRes.status).toBe(200);

    // Wait until payment status is updated to REFUNDED
    const finalPayment = await waitForPayment(payment.id, (p) => p.status === "REFUNDED");
    expect(finalPayment.status).toBe("REFUNDED");
    expect(finalPayment.refunded_at).not.toBeNull();
    expect(finalPayment.provider_refund_id).toBe("ref_pending_2");
  });

  it("a failed refund request leaves REFUND_PENDING and the cancellation still succeeds", async () => {
    const { passengerToken, reservation, payment } = await createPaidReservationFixture({
      provider: "PAYSTACK",
      paymentStatus: "SUCCEEDED",
      reservationStatus: "CONFIRMED",
    });

    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ status: false, message: "Provider error" }),
    });
    global.fetch = fetchMock;

    const res = await request(app)
      .post(`/reservations/${reservation.id}/cancel`)
      .set("Authorization", `Bearer ${passengerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");

    // Wait until error is logged and stored in payment
    const updated = await waitForPayment(payment.id, (p) => p.refund_error !== null);
    expect(updated.status).toBe("REFUND_PENDING");
    expect(updated.refund_error).toContain("Paystack refund responded with status 400");
  });

  it("a signed refund.failed event gives REFUND_FAILED", async () => {
    const { payment } = await createPaidReservationFixture({
      provider: "PAYSTACK",
      paymentStatus: "REFUND_PENDING",
    });

    const webhookPayload = {
      event: "refund.failed",
      data: {
        transaction_reference: payment.provider_reference,
      },
    };
    const rawBody = JSON.stringify(webhookPayload);
    const signature = computeSignature(rawBody);

    const res = await request(app)
      .post("/webhooks/paystack")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(rawBody);

    expect(res.status).toBe(200);

    const paymentRepo = AppDataSource.getRepository(Payment);
    const updated = await paymentRepo.findOne({ where: { id: payment.id } });
    expect(updated?.status).toBe("REFUND_FAILED");
    expect(updated?.refund_error).toBe("Refund failed at provider");
  });

  it("driver cancel with two paid and one unpaid reservation makes exactly two refund requests", async () => {
    const fix1 = await createPaidReservationFixture({
      provider: "PAYSTACK",
      paymentStatus: "SUCCEEDED",
      reservationStatus: "CONFIRMED",
    });
    const fix2 = await createPaidReservationFixture({
      provider: "PAYSTACK",
      paymentStatus: "SUCCEEDED",
      reservationStatus: "CONFIRMED",
    });
    const fix3 = await createPaidReservationFixture({
      provider: "PAYSTACK",
      paymentStatus: "PENDING",
      reservationStatus: "PENDING_PAYMENT",
    });

    const fetchMock = jest.fn().mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: true,
          data: { id: `ref_drv_${crypto.randomUUID()}`, status: "processed" },
        }),
      };
    });
    global.fetch = fetchMock;

    const res = await request(app)
      .post(`/departures/${testDeparture.id}/cancel`)
      .set("Authorization", `Bearer ${driverToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");
    expect(res.body.cancelledReservations).toBe(3);

    // Wait for the two paid payments to become REFUNDED
    await waitForPayment(fix1.payment.id, (p) => p.status === "REFUNDED");
    await waitForPayment(fix2.payment.id, (p) => p.status === "REFUNDED");

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const paymentRepo = AppDataSource.getRepository(Payment);
    const unpaidPayment = await paymentRepo.findOne({ where: { id: fix3.payment.id } });
    expect(unpaidPayment?.status).toBe("EXPIRED");

    // Notifications check
    const notifRepo = AppDataSource.getRepository(Notification);
    const notifsP1 = await notifRepo.find({ where: { user_id: fix1.passenger.id } });
    expect(notifsP1.length).toBe(1);
    expect(notifsP1[0].payload.refund).toEqual({
      simulated: false,
      status: "PENDING",
      amount: "3500.00",
    });

    const notifsP3 = await notifRepo.find({ where: { user_id: fix3.passenger.id } });
    expect(notifsP3.length).toBe(1);
    expect(notifsP3[0].payload.refund).toBeNull();
  });

  it("a late charge.success after the hold expired ends with payment REFUND_PENDING then REFUNDED, the reservation EXPIRED and one refund request", async () => {
    const expiredHold = new Date(Date.now() - 5 * 60 * 1000);
    const { reservation, payment } = await createPaidReservationFixture({
      provider: "PAYSTACK",
      paymentStatus: "PENDING",
      reservationStatus: "PENDING_PAYMENT",
      holdExpiresAt: expiredHold,
    });

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: true,
        data: { id: "ref_late_hold", status: "processed" },
      }),
    });
    global.fetch = fetchMock;

    const webhookPayload = {
      event: "charge.success",
      data: {
        status: "success",
        reference: payment.provider_reference,
        amount: toKobo(payment.amount),
        currency: "NGN",
      },
    };
    const rawBody = JSON.stringify(webhookPayload);
    const signature = computeSignature(rawBody);

    const res = await request(app)
      .post("/webhooks/paystack")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(rawBody);

    expect(res.status).toBe(200);

    // Payment should transition to REFUND_PENDING and then REFUNDED
    const finalPayment = await waitForPayment(payment.id, (p) => p.status === "REFUNDED");
    expect(finalPayment.status).toBe("REFUNDED");
    expect(finalPayment.provider_refund_id).toBe("ref_late_hold");

    const reservationRepo = AppDataSource.getRepository(Reservation);
    const dbReservation = await reservationRepo.findOne({ where: { id: reservation.id } });
    expect(dbReservation?.status).toBe("EXPIRED");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a charge.success after the departure was cancelled does the same", async () => {
    const { reservation, payment } = await createPaidReservationFixture({
      provider: "PAYSTACK",
      paymentStatus: "PENDING",
      reservationStatus: "PENDING_PAYMENT",
    });

    await AppDataSource.query(`UPDATE departures SET status = 'CANCELLED' WHERE id = $1;`, [
      testDeparture.id,
    ]);

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: true,
        data: { id: "ref_dep_canc", status: "processed" },
      }),
    });
    global.fetch = fetchMock;

    const webhookPayload = {
      event: "charge.success",
      data: {
        status: "success",
        reference: payment.provider_reference,
        amount: toKobo(payment.amount),
        currency: "NGN",
      },
    };
    const rawBody = JSON.stringify(webhookPayload);
    const signature = computeSignature(rawBody);

    const res = await request(app)
      .post("/webhooks/paystack")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(rawBody);

    expect(res.status).toBe(200);

    const finalPayment = await waitForPayment(payment.id, (p) => p.status === "REFUNDED");
    expect(finalPayment.status).toBe("REFUNDED");
    expect(finalPayment.provider_refund_id).toBe("ref_dep_canc");

    const reservationRepo = AppDataSource.getRepository(Reservation);
    const dbReservation = await reservationRepo.findOne({ where: { id: reservation.id } });
    expect(dbReservation?.status).toBe("EXPIRED");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a duplicate charge.success on an already SUCCEEDED payment makes no refund request", async () => {
    const { payment } = await createPaidReservationFixture({
      provider: "PAYSTACK",
      paymentStatus: "SUCCEEDED",
      reservationStatus: "CONFIRMED",
    });

    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const webhookPayload = {
      event: "charge.success",
      data: {
        status: "success",
        reference: payment.provider_reference,
        amount: toKobo(payment.amount),
        currency: "NGN",
      },
    };
    const rawBody = JSON.stringify(webhookPayload);
    const signature = computeSignature(rawBody);

    const res = await request(app)
      .post("/webhooks/paystack")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(rawBody);

    expect(res.status).toBe(200);

    // Allow any pending promises to flush
    await new Promise((r) => setTimeout(r, 200));

    expect(fetchMock).toHaveBeenCalledTimes(0);

    const paymentRepo = AppDataSource.getRepository(Payment);
    const dbPayment = await paymentRepo.findOne({ where: { id: payment.id } });
    expect(dbPayment?.status).toBe("SUCCEEDED");
  });

  it("a second payment succeeding for an already confirmed reservation is refunded", async () => {
    const { reservation, payment: paymentA } = await createPaidReservationFixture({
      provider: "PAYSTACK",
      paymentStatus: "SUCCEEDED",
      reservationStatus: "CONFIRMED",
    });

    const paymentRepo = AppDataSource.getRepository(Payment);
    const paymentBRef = `mm_second_${crypto.randomUUID()}`;
    const paymentB = await paymentRepo.save(
      paymentRepo.create({
        reservation_id: reservation.id,
        amount: "3500.00",
        status: "PENDING",
        provider: "PAYSTACK",
        provider_reference: paymentBRef,
        idempotency_key: crypto.randomUUID(),
      })
    );

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: true,
        data: { id: "ref_second_pay", status: "processed" },
      }),
    });
    global.fetch = fetchMock;

    const webhookPayload = {
      event: "charge.success",
      data: {
        status: "success",
        reference: paymentBRef,
        amount: toKobo(paymentB.amount),
        currency: "NGN",
      },
    };
    const rawBody = JSON.stringify(webhookPayload);
    const signature = computeSignature(rawBody);

    const res = await request(app)
      .post("/webhooks/paystack")
      .set("Content-Type", "application/json")
      .set("x-paystack-signature", signature)
      .send(rawBody);

    expect(res.status).toBe(200);

    const updatedB = await waitForPayment(paymentB.id, (p) => p.status === "REFUNDED");
    expect(updatedB.status).toBe("REFUNDED");
    expect(updatedB.provider_refund_id).toBe("ref_second_pay");

    const updatedA = await paymentRepo.findOne({ where: { id: paymentA.id } });
    expect(updatedA?.status).toBe("SUCCEEDED");

    const reservationRepo = AppDataSource.getRepository(Reservation);
    const dbRes = await reservationRepo.findOne({ where: { id: reservation.id } });
    expect(dbRes?.status).toBe("CONFIRMED");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a cancel of a SIMULATED payment is unchanged (REFUNDED at once, no fake request)", async () => {
    const { passengerToken, reservation, payment } = await createPaidReservationFixture({
      provider: "SIMULATED",
      paymentStatus: "SUCCEEDED",
      reservationStatus: "CONFIRMED",
    });

    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const res = await request(app)
      .post(`/reservations/${reservation.id}/cancel`)
      .set("Authorization", `Bearer ${passengerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CANCELLED");
    expect(res.body.refund).toMatchObject({
      simulated: true,
      paymentId: payment.id,
      amount: "3500.00",
    });

    const paymentRepo = AppDataSource.getRepository(Payment);
    const dbPayment = await paymentRepo.findOne({ where: { id: payment.id } });
    expect(dbPayment?.status).toBe("REFUNDED");
    expect(dbPayment?.refunded_at).not.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});
