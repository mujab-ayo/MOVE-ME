import request from "supertest";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import app from "../app";
import { AppDataSource } from "../data-source";
import { User } from "../entities/user.entity";
import { Vehicle } from "../entities/vehicle.entity";
import { Route } from "../entities/route.entity";
import { Departure } from "../entities/departure.entity";

dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env" });

describe("Departure Endpoints Integration", () => {
  const secret = process.env.JWT_SECRET || "ride_pooling_capstone_dev_secret_key_2026";
  let driver: User;
  let driverB: User;
  let driverC: User;
  let passenger: User;
  let driverToken: string;
  let passengerToken: string;
  let testRoute: Route;
  let testVehicle: Vehicle;
  let testVehicleB: Vehicle;
  let testVehicleC: Vehicle;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const departureRepo = AppDataSource.getRepository(Departure);
    const vehicleRepo = AppDataSource.getRepository(Vehicle);
    const userRepo = AppDataSource.getRepository(User);
    const routeRepo = AppDataSource.getRepository(Route);

    // Clean up
    await departureRepo.createQueryBuilder().delete().execute();
    await vehicleRepo.createQueryBuilder().delete().execute();
    await userRepo.createQueryBuilder().delete().execute();
    await routeRepo.createQueryBuilder().delete().execute();

    driver = await userRepo.save(
      userRepo.create({
        email: "dep_driver_a@test.com",
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    driverB = await userRepo.save(
      userRepo.create({
        email: "dep_driver_b@test.com",
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    driverC = await userRepo.save(
      userRepo.create({
        email: "dep_driver_c@test.com",
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: true,
      })
    );

    passenger = await userRepo.save(
      userRepo.create({
        email: "dep_passenger@test.com",
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
        base_fare_solo: "7500.00",
        base_fare_per_seat: "2500.00",
        active: true,
      })
    );

    testVehicle = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: driver.id,
        description: "Toyota Camry",
        registration_identifier: "DEP-REG-100",
        seat_capacity: 4,
        active: true,
      })
    );

    testVehicleB = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: driverB.id,
        description: "Honda Civic",
        registration_identifier: "DEP-REG-200",
        seat_capacity: 4,
        active: true,
      })
    );

    testVehicleC = await vehicleRepo.save(
      vehicleRepo.create({
        driver_id: driverC.id,
        description: "Hyundai Elantra",
        registration_identifier: "DEP-REG-300",
        seat_capacity: 4,
        active: true,
      })
    );
  }, 30000);

  afterAll(async () => {
    const departureRepo = AppDataSource.getRepository(Departure);
    const vehicleRepo = AppDataSource.getRepository(Vehicle);
    const userRepo = AppDataSource.getRepository(User);
    const routeRepo = AppDataSource.getRepository(Route);

    await departureRepo.createQueryBuilder().delete().execute();
    await vehicleRepo.createQueryBuilder().delete().execute();
    await userRepo.createQueryBuilder().delete().execute();
    await routeRepo.createQueryBuilder().delete().execute();

    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }, 30000);

  beforeEach(async () => {
    const departureRepo = AppDataSource.getRepository(Departure);
    await departureRepo.createQueryBuilder().delete().execute();
  });

  describe("GET /departures/search", () => {
    it("rejects unauthenticated requests with 401", async () => {
      const res = await request(app)
        .get("/departures/search")
        .query({
          routeId: testRoute.id,
          mode: "SOLO",
          when: "immediate",
        });

      expect(res.status).toBe(401);
    });

    it("rejects non-passenger roles with 403", async () => {
      const res = await request(app)
        .get("/departures/search")
        .set("Authorization", `Bearer ${driverToken}`)
        .query({
          routeId: testRoute.id,
          mode: "SOLO",
          when: "immediate",
        });

      expect(res.status).toBe(403);
    });

    it("rejects invalid query parameters with 400", async () => {
      const res = await request(app)
        .get("/departures/search")
        .set("Authorization", `Bearer ${passengerToken}`)
        .query({
          routeId: "not-a-uuid",
          mode: "INVALID_MODE",
          when: "tomorrow",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
    });

    it("rejects scheduled search without datetime with 400", async () => {
      const res = await request(app)
        .get("/departures/search")
        .set("Authorization", `Bearer ${passengerToken}`)
        .query({
          routeId: testRoute.id,
          mode: "SOLO",
          when: "scheduled",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
    });

    it("returns 200 with { results: [], empty: true } when no departures match (never 404)", async () => {
      const res = await request(app)
        .get("/departures/search")
        .set("Authorization", `Bearer ${passengerToken}`)
        .query({
          routeId: testRoute.id,
          mode: "SOLO",
          when: "immediate",
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        results: [],
        empty: true,
      });
    });

    it("immediate search: returns departures within now and now + 15 minutes, soonest first", async () => {
      const departureRepo = AppDataSource.getRepository(Departure);
      const now = Date.now();

      // 1. In immediate window (5 mins from now, driver A)
      const dep1 = await departureRepo.save(
        departureRepo.create({
          driver_id: driver.id,
          vehicle_id: testVehicle.id,
          route_id: testRoute.id,
          mode: "SOLO",
          departure_time: new Date(now + 5 * 60 * 1000),
          duration_minutes: 45,
          fare_amount: "7500.00",
          capacity: 1,
          status: "SCHEDULED",
        })
      );

      // 2. In immediate window (10 mins from now, driver B)
      const dep2 = await departureRepo.save(
        departureRepo.create({
          driver_id: driverB.id,
          vehicle_id: testVehicleB.id,
          route_id: testRoute.id,
          mode: "SOLO",
          departure_time: new Date(now + 10 * 60 * 1000),
          duration_minutes: 45,
          fare_amount: "7500.00",
          capacity: 1,
          status: "SCHEDULED",
        })
      );

      // 3. Outside immediate window (60 mins from now, driver C)
      await departureRepo.save(
        departureRepo.create({
          driver_id: driverC.id,
          vehicle_id: testVehicleC.id,
          route_id: testRoute.id,
          mode: "SOLO",
          departure_time: new Date(now + 60 * 60 * 1000),
          duration_minutes: 45,
          fare_amount: "7500.00",
          capacity: 1,
          status: "SCHEDULED",
        })
      );

      // 4. In immediate window but CANCELLED status (excluded from search and from exclusion constraint)
      await departureRepo.save(
        departureRepo.create({
          driver_id: driver.id,
          vehicle_id: testVehicle.id,
          route_id: testRoute.id,
          mode: "SOLO",
          departure_time: new Date(now + 8 * 60 * 1000),
          duration_minutes: 45,
          fare_amount: "7500.00",
          capacity: 1,
          status: "CANCELLED",
        })
      );

      // 5. In immediate window but different mode POOLED (should be excluded)
      await departureRepo.save(
        departureRepo.create({
          driver_id: driverC.id,
          vehicle_id: testVehicleC.id,
          route_id: testRoute.id,
          mode: "POOLED",
          departure_time: new Date(now + 6 * 60 * 1000),
          duration_minutes: 45,
          fare_amount: "2500.00",
          capacity: 4,
          status: "SCHEDULED",
        })
      );

      const res = await request(app)
        .get("/departures/search")
        .set("Authorization", `Bearer ${passengerToken}`)
        .query({
          routeId: testRoute.id,
          mode: "SOLO",
          when: "immediate",
        });

      expect(res.status).toBe(200);
      expect(res.body.empty).toBe(false);
      expect(res.body.results).toHaveLength(2);

      // Assert soonest first
      expect(res.body.results[0].id).toBe(dep1.id);
      expect(res.body.results[1].id).toBe(dep2.id);

      // Check fields
      const item = res.body.results[0];
      expect(item.pickup_point).toBe(testRoute.pickup_point);
      expect(item.dropoff_point).toBe(testRoute.dropoff_point);
      expect(item.departure_time).toBeDefined();
      expect(item.driver_name).toBe(driver.email);
      expect(item.fare_amount).toBe("7500.00");
      expect(item.mode).toBe("SOLO");
      expect(item.capacity).toBe(1);
      expect(item.available_capacity).toBe(1);
    });

    it("scheduled search: returns departures >= datetime ordered by departure_time ASC with limit 20", async () => {
      const departureRepo = AppDataSource.getRepository(Departure);
      const baseTime = new Date("2026-11-01T08:00:00Z").getTime();

      // Create 25 non-overlapping departures (spaced by 60 mins, duration 45 mins)
      const deps = [];
      for (let i = 0; i < 25; i++) {
        deps.push(
          departureRepo.create({
            driver_id: driver.id,
            vehicle_id: testVehicle.id,
            route_id: testRoute.id,
            mode: "POOLED",
            departure_time: new Date(baseTime + i * 60 * 60 * 1000), // every 60 mins
            duration_minutes: 45,
            fare_amount: "2500.00",
            capacity: 4,
            status: "SCHEDULED",
          })
        );
      }
      await departureRepo.save(deps);

      // Also create one departure earlier than target datetime (should be excluded from results)
      await departureRepo.save(
        departureRepo.create({
          driver_id: driver.id,
          vehicle_id: testVehicle.id,
          route_id: testRoute.id,
          mode: "POOLED",
          departure_time: new Date(baseTime - 60 * 60 * 1000), // 07:00 -> 07:45, no overlap with 08:00
          duration_minutes: 45,
          fare_amount: "2500.00",
          capacity: 4,
          status: "SCHEDULED",
        })
      );

      const targetIso = new Date(baseTime).toISOString();
      const res = await request(app)
        .get("/departures/search")
        .set("Authorization", `Bearer ${passengerToken}`)
        .query({
          routeId: testRoute.id,
          mode: "POOLED",
          when: "scheduled",
          datetime: targetIso,
        });

      expect(res.status).toBe(200);
      expect(res.body.empty).toBe(false);
      // Must be capped at limit 20
      expect(res.body.results).toHaveLength(20);

      // Verify ascending order
      for (let i = 0; i < res.body.results.length - 1; i++) {
        const timeA = new Date(res.body.results[i].departure_time).getTime();
        const timeB = new Date(res.body.results[i + 1].departure_time).getTime();
        expect(timeA).toBeLessThanOrEqual(timeB);
      }

      // Check fields for pooled
      const item = res.body.results[0];
      expect(item.mode).toBe("POOLED");
      expect(item.capacity).toBe(4);
      expect(item.available_capacity).toBe(4);
      expect(item.fare_amount).toBe("2500.00");
    });
  });
});
