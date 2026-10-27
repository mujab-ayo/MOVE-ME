import request from "supertest";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import app from "../app";
import { AppDataSource } from "../data-source";
import { User } from "../entities/user.entity";
import { Vehicle } from "../entities/vehicle.entity";
import { Route } from "../entities/route.entity";
import { Departure } from "../entities/departure.entity";

dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env", quiet: true });

describe("Departure Publishing Integration (POST /departures / MM-02)", () => {
  const secret = process.env.JWT_SECRET || "ride_pooling_capstone_dev_secret_key_2026";
  let enabledDriver: User;
  let disabledDriver: User;
  let anotherDriver: User;
  let passenger: User;

  let enabledDriverToken: string;
  let disabledDriverToken: string;
  let anotherDriverToken: string;
  let passengerToken: string;

  let testRoute: Route;
  let soloVehicle: Vehicle;
  let pooledVehicle: Vehicle;
  let secondDriverVehicle: Vehicle;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const userRepo = AppDataSource.getRepository(User);
    const vehicleRepo = AppDataSource.getRepository(Vehicle);
    const routeRepo = AppDataSource.getRepository(Route);
    const departureRepo = AppDataSource.getRepository(Departure);

    // Cleanup
    await AppDataSource.query(`DELETE FROM notifications;`);
    await AppDataSource.query(`DELETE FROM payments;`);
    await AppDataSource.query(`DELETE FROM reservations;`);
    await departureRepo.createQueryBuilder().delete().execute();
    await vehicleRepo.createQueryBuilder().delete().execute();
    await userRepo.createQueryBuilder().delete().execute();
    await routeRepo.createQueryBuilder().delete().execute();

    enabledDriver = await userRepo.save(
      userRepo.create({
        email: `enabled-drv-${Date.now()}@test.com`,
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    disabledDriver = await userRepo.save(
      userRepo.create({
        email: `disabled-drv-${Date.now()}@test.com`,
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: false,
      })
    );

    anotherDriver = await userRepo.save(
      userRepo.create({
        email: `other-drv-${Date.now()}@test.com`,
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    passenger = await userRepo.save(
      userRepo.create({
        email: `pub-pass-${Date.now()}@test.com`,
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    enabledDriverToken = jwt.sign(
      { sub: enabledDriver.id, role: enabledDriver.role },
      secret
    );
    disabledDriverToken = jwt.sign(
      { sub: disabledDriver.id, role: disabledDriver.role },
      secret
    );
    anotherDriverToken = jwt.sign(
      { sub: anotherDriver.id, role: anotherDriver.role },
      secret
    );
    passengerToken = jwt.sign(
      { sub: passenger.id, role: passenger.role },
      secret
    );

    testRoute = await routeRepo.save(
      routeRepo.create({
        pickup_point: "Publish Pickup Terminal",
        dropoff_point: "Publish Dropoff Terminal",
        base_duration_minutes: 45,
        base_fare_solo: "5000.00",
        base_fare_per_seat: "2000.00",
        active: true,
      })
    );

    soloVehicle = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: enabledDriver.id,
        description: "Driver A Solo Car",
        registration_identifier: `PUB-SOLO-${Date.now()}`,
        seat_capacity: 1,
        active: true,
      })
    );

    pooledVehicle = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: enabledDriver.id,
        description: "Driver A Pooled Van",
        registration_identifier: `PUB-POOL-${Date.now()}`,
        seat_capacity: 4,
        active: true,
      })
    );

    secondDriverVehicle = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: anotherDriver.id,
        description: "Driver B Van",
        registration_identifier: `PUB-OTHER-${Date.now()}`,
        seat_capacity: 4,
        active: true,
      })
    );
  }, 60000);

  afterAll(async () => {
    const userRepo = AppDataSource.getRepository(User);
    const vehicleRepo = AppDataSource.getRepository(Vehicle);
    const routeRepo = AppDataSource.getRepository(Route);
    const departureRepo = AppDataSource.getRepository(Departure);

    await AppDataSource.query(`DELETE FROM notifications;`);
    await AppDataSource.query(`DELETE FROM payments;`);
    await AppDataSource.query(`DELETE FROM reservations;`);
    await departureRepo.createQueryBuilder().delete().execute();
    await vehicleRepo.createQueryBuilder().delete().execute();
    await userRepo.createQueryBuilder().delete().execute();
    await routeRepo.createQueryBuilder().delete().execute();

    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }, 60000);

  it("201 publish SOLO (capacity 1, fare and duration snapshotted from the route)", async () => {
    const departureTime = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const res = await request(app)
      .post("/departures")
      .set("Authorization", `Bearer ${enabledDriverToken}`)
      .send({
        vehicleId: soloVehicle.id,
        routeId: testRoute.id,
        mode: "SOLO",
        departureTime,
      });

    expect(res.status).toBe(201);
    expect(res.body.departureId).toBeDefined();
    expect(res.body.capacity).toBe(1);
    expect(res.body.fareAmount).toBe(testRoute.base_fare_solo);
    expect(res.body.durationMinutes).toBe(testRoute.base_duration_minutes);
    expect(res.body.status).toBe("SCHEDULED");

    const departureRepo = AppDataSource.getRepository(Departure);
    const dbDep = await departureRepo.findOneBy({ id: res.body.departureId });
    expect(dbDep).toBeDefined();
    expect(dbDep?.capacity).toBe(1);
    expect(dbDep?.fare_amount).toBe("5000.00");
    expect(dbDep?.duration_minutes).toBe(45);
    expect(dbDep?.status).toBe("SCHEDULED");
  });

  it("201 publish POOLED (capacity equals the vehicle's seats)", async () => {
    const departureTime = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    const res = await request(app)
      .post("/departures")
      .set("Authorization", `Bearer ${enabledDriverToken}`)
      .send({
        vehicleId: pooledVehicle.id,
        routeId: testRoute.id,
        mode: "POOLED",
        departureTime,
      });

    expect(res.status).toBe(201);
    expect(res.body.departureId).toBeDefined();
    expect(res.body.capacity).toBe(pooledVehicle.seat_capacity);
    expect(res.body.fareAmount).toBe(testRoute.base_fare_per_seat);
    expect(res.body.durationMinutes).toBe(testRoute.base_duration_minutes);
    expect(res.body.status).toBe("SCHEDULED");

    const departureRepo = AppDataSource.getRepository(Departure);
    const dbDep = await departureRepo.findOneBy({ id: res.body.departureId });
    expect(dbDep).toBeDefined();
    expect(dbDep?.capacity).toBe(4);
    expect(dbDep?.fare_amount).toBe("2000.00");
  });

  it("409 overlapping departure for the same driver", async () => {
    const baseTime = new Date(Date.now() + 72 * 3600 * 1000);
    const res1 = await request(app)
      .post("/departures")
      .set("Authorization", `Bearer ${enabledDriverToken}`)
      .send({
        vehicleId: soloVehicle.id,
        routeId: testRoute.id,
        mode: "SOLO",
        departureTime: baseTime.toISOString(),
      });
    expect(res1.status).toBe(201);

    // Attempt overlapping departure with a different vehicle for the same driver (starts 15 minutes after baseTime; duration is 45 mins)
    const overlapTime = new Date(baseTime.getTime() + 15 * 60 * 1000).toISOString();
    const res2 = await request(app)
      .post("/departures")
      .set("Authorization", `Bearer ${enabledDriverToken}`)
      .send({
        vehicleId: pooledVehicle.id,
        routeId: testRoute.id,
        mode: "POOLED",
        departureTime: overlapTime,
      });

    expect(res2.status).toBe(409);
    expect(res2.body).toEqual({
      error: "Overlapping departure detected for this driver or vehicle",
    });
  });

  it("201 back-to-back departure starting exactly when the first one ends", async () => {
    // Departure ends at baseTime + 45 minutes
    const baseTime = new Date(Date.now() + 96 * 3600 * 1000);
    const res1 = await request(app)
      .post("/departures")
      .set("Authorization", `Bearer ${enabledDriverToken}`)
      .send({
        vehicleId: soloVehicle.id,
        routeId: testRoute.id,
        mode: "SOLO",
        departureTime: baseTime.toISOString(),
      });
    expect(res1.status).toBe(201);

    // Exactly when the 45-minute trip ends
    const backToBackTime = new Date(
      baseTime.getTime() + 45 * 60 * 1000
    ).toISOString();
    const res2 = await request(app)
      .post("/departures")
      .set("Authorization", `Bearer ${enabledDriverToken}`)
      .send({
        vehicleId: soloVehicle.id,
        routeId: testRoute.id,
        mode: "SOLO",
        departureTime: backToBackTime,
      });

    expect(res2.status).toBe(201);
    expect(res2.body.status).toBe("SCHEDULED");
  });

  it("409 overlap on the same vehicle", async () => {
    const baseTime = new Date(Date.now() + 120 * 3600 * 1000);
    const res1 = await request(app)
      .post("/departures")
      .set("Authorization", `Bearer ${enabledDriverToken}`)
      .send({
        vehicleId: pooledVehicle.id,
        routeId: testRoute.id,
        mode: "POOLED",
        departureTime: baseTime.toISOString(),
      });
    expect(res1.status).toBe(201);

    // Overlapping time for the same vehicle
    const overlapTime = new Date(baseTime.getTime() + 20 * 60 * 1000).toISOString();
    const res2 = await request(app)
      .post("/departures")
      .set("Authorization", `Bearer ${enabledDriverToken}`)
      .send({
        vehicleId: pooledVehicle.id,
        routeId: testRoute.id,
        mode: "POOLED",
        departureTime: overlapTime,
      });

    expect(res2.status).toBe(409);
    expect(res2.body).toEqual({
      error: "Overlapping departure detected for this driver or vehicle",
    });
  });

  it("403 passenger", async () => {
    const res = await request(app)
      .post("/departures")
      .set("Authorization", `Bearer ${passengerToken}`)
      .send({
        vehicleId: soloVehicle.id,
        routeId: testRoute.id,
        mode: "SOLO",
        departureTime: new Date(Date.now() + 144 * 3600 * 1000).toISOString(),
      });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Forbidden: insufficient permissions" });
  });

  it("401 no token", async () => {
    const res = await request(app)
      .post("/departures")
      .send({
        vehicleId: soloVehicle.id,
        routeId: testRoute.id,
        mode: "SOLO",
        departureTime: new Date(Date.now() + 144 * 3600 * 1000).toISOString(),
      });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: "Authentication token missing or invalid",
    });
  });

  it("403 driver not enabled", async () => {
    const res = await request(app)
      .post("/departures")
      .set("Authorization", `Bearer ${disabledDriverToken}`)
      .send({
        vehicleId: soloVehicle.id,
        routeId: testRoute.id,
        mode: "SOLO",
        departureTime: new Date(Date.now() + 144 * 3600 * 1000).toISOString(),
      });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: "Driver is not enabled to publish departures",
    });
  });

  it("403 vehicle owned by another driver", async () => {
    const res = await request(app)
      .post("/departures")
      .set("Authorization", `Bearer ${enabledDriverToken}`)
      .send({
        vehicleId: secondDriverVehicle.id,
        routeId: testRoute.id,
        mode: "POOLED",
        departureTime: new Date(Date.now() + 144 * 3600 * 1000).toISOString(),
      });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Vehicle does not belong to driver" });
  });

  it("404 unknown route", async () => {
    const res = await request(app)
      .post("/departures")
      .set("Authorization", `Bearer ${enabledDriverToken}`)
      .send({
        vehicleId: soloVehicle.id,
        routeId: "00000000-0000-0000-0000-000000000000",
        mode: "SOLO",
        departureTime: new Date(Date.now() + 144 * 3600 * 1000).toISOString(),
      });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Route not found" });
  });

  it("400 invalid body", async () => {
    const res = await request(app)
      .post("/departures")
      .set("Authorization", `Bearer ${enabledDriverToken}`)
      .send({
        vehicleId: "not-a-valid-uuid",
        mode: "INVALID_MODE",
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Validation failed" });
  });
});
