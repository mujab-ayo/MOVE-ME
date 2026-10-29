import crypto from "crypto";
import dotenv from "dotenv";
import { AppDataSource } from "../data-source";
import { User } from "../entities/user.entity";
import { Vehicle } from "../entities/vehicle.entity";
import { Route } from "../entities/route.entity";
import { Departure } from "../entities/departure.entity";
import { Reservation } from "../entities/reservation.entity";
import { Payment, PaymentStatus, PaymentProvider } from "../entities/payment.entity";
import { Notification } from "../entities/notification.entity";
import { requestRefund } from "./refund.service";

dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env", quiet: true });

describe("Refund Service (src/services/refund.service.test.ts)", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  let driver: User;
  let passenger: User;
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
        email: "refund_srv_driver@test.com",
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    passenger = await userRepo.save(
      userRepo.create({
        email: "refund_srv_passenger@test.com",
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    testRoute = await routeRepo.save(
      routeRepo.create({
        pickup_point: "Refund Victoria Island Terminal",
        dropoff_point: "Refund Lekki Phase 1 Gate",
        base_duration_minutes: 40,
        base_fare_solo: "8000.00",
        base_fare_per_seat: "4000.00",
        active: true,
      })
    );

    testVehicle = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: driver.id,
        description: "Toyota Camry",
        registration_identifier: "REF-SRV-101",
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
        duration_minutes: 40,
        fare_amount: "4000.00",
        capacity: 4,
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

    const paymentRepo = AppDataSource.getRepository(Payment);
    const reservationRepo = AppDataSource.getRepository(Reservation);

    await paymentRepo.createQueryBuilder().delete().execute();
    await reservationRepo.createQueryBuilder().delete().execute();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    restoreEnv();
  });

  async function createPaymentFixture(options?: {
    provider?: PaymentProvider;
    status?: PaymentStatus;
    providerReference?: string | null;
    amount?: string;
  }): Promise<{ reservation: Reservation; payment: Payment }> {
    const reservationRepo = AppDataSource.getRepository(Reservation);
    const paymentRepo = AppDataSource.getRepository(Payment);

    const provider: PaymentProvider = options?.provider ?? "PAYSTACK";
    const status: PaymentStatus = options?.status ?? "REFUND_PENDING";
    const amount = options?.amount ?? "4000.00";
    const ref =
      options?.providerReference !== undefined
        ? options.providerReference
        : provider === "PAYSTACK"
        ? `mm_${crypto.randomUUID()}`
        : null;

    const userRepo = AppDataSource.getRepository(User);
    const p = await userRepo.save(
      userRepo.create({
        email: `refund_p_${crypto.randomUUID()}@test.com`,
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    const reservation = await reservationRepo.save(
      reservationRepo.create({
        departure_id: testDeparture.id,
        passenger_id: p.id,
        status: "CONFIRMED",
        fare_amount: amount,
        hold_expires_at: new Date(Date.now() + 15 * 60 * 1000),
      })
    );

    const payment = await paymentRepo.save(
      paymentRepo.create({
        reservation_id: reservation.id,
        amount,
        status,
        provider,
        provider_reference: ref,
        idempotency_key: crypto.randomUUID(),
      })
    );

    return { reservation, payment };
  }

  it("a processed answer gives REFUNDED with refunded_at", async () => {
    const { payment } = await createPaymentFixture({
      provider: "PAYSTACK",
      status: "REFUND_PENDING",
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: true,
        data: {
          id: "ref_processed_101",
          status: "processed",
        },
      }),
    });

    await requestRefund(payment.id);

    const paymentRepo = AppDataSource.getRepository(Payment);
    const updated = await paymentRepo.findOne({ where: { id: payment.id } });

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("REFUNDED");
    expect(updated!.refunded_at).not.toBeNull();
    expect(updated!.provider_refund_id).toBe("ref_processed_101");
  });

  it("a pending answer keeps REFUND_PENDING and stores the refund id", async () => {
    const { payment } = await createPaymentFixture({
      provider: "PAYSTACK",
      status: "REFUND_PENDING",
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        status: true,
        data: {
          id: "ref_pending_202",
          status: "pending",
        },
      }),
    });

    await requestRefund(payment.id);

    const paymentRepo = AppDataSource.getRepository(Payment);
    const updated = await paymentRepo.findOne({ where: { id: payment.id } });

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("REFUND_PENDING");
    expect(updated!.refunded_at).toBeNull();
    expect(updated!.provider_refund_id).toBe("ref_pending_202");
  });

  it("a failing answer keeps REFUND_PENDING and stores refund_error", async () => {
    const { payment } = await createPaymentFixture({
      provider: "PAYSTACK",
      status: "REFUND_PENDING",
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        status: false,
        message: "Transaction not found",
      }),
    });

    await requestRefund(payment.id);

    const paymentRepo = AppDataSource.getRepository(Payment);
    const updated = await paymentRepo.findOne({ where: { id: payment.id } });

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("REFUND_PENDING");
    expect(updated!.refund_error).toBe("Paystack refund responded with status 400");
  });

  it("two simultaneous calls make exactly one request to the fake", async () => {
    const { payment } = await createPaymentFixture({
      provider: "PAYSTACK",
      status: "REFUND_PENDING",
    });

    const fetchMock = jest.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: true,
          data: {
            id: "ref_concurrent_303",
            status: "processed",
          },
        }),
      };
    });
    global.fetch = fetchMock;

    await Promise.all([requestRefund(payment.id), requestRefund(payment.id)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const paymentRepo = AppDataSource.getRepository(Payment);
    const updated = await paymentRepo.findOne({ where: { id: payment.id } });
    expect(updated!.status).toBe("REFUNDED");
    expect(updated!.provider_refund_id).toBe("ref_concurrent_303");
  });

  it("a call for a SIMULATED payment or a non-REFUND_PENDING payment makes none", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const { payment: simulatedPayment } = await createPaymentFixture({
      provider: "SIMULATED",
      status: "REFUND_PENDING",
    });

    const { payment: succeededPayment } = await createPaymentFixture({
      provider: "PAYSTACK",
      status: "SUCCEEDED",
    });

    const { payment: pendingPayment } = await createPaymentFixture({
      provider: "PAYSTACK",
      status: "PENDING",
    });

    await requestRefund(simulatedPayment.id);
    await requestRefund(succeededPayment.id);
    await requestRefund(pendingPayment.id);

    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("the request body has the payment's reference in the transaction field and no amount", async () => {
    const targetReference = `mm_ref_test_${crypto.randomUUID()}`;
    const { payment } = await createPaymentFixture({
      provider: "PAYSTACK",
      status: "REFUND_PENDING",
      providerReference: targetReference,
      amount: "5000.00",
    });

    let capturedInit: any = null;
    global.fetch = jest.fn().mockImplementation(async (_url, init) => {
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: true,
          data: {
            id: "ref_body_404",
            status: "processed",
          },
        }),
      };
    });

    await requestRefund(payment.id);

    expect(capturedInit).not.toBeNull();
    const parsedBody = JSON.parse(capturedInit.body);

    expect(parsedBody.transaction).toBe(targetReference);
    expect(parsedBody).not.toHaveProperty("amount");
    expect(parsedBody.amount).toBeUndefined();
  });
});
