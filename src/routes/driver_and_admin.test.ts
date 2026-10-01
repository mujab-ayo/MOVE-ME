import request from "supertest";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import app from "../app";
import { AppDataSource } from "../data-source";
import { User } from "../entities/user.entity";
import { Vehicle } from "../entities/vehicle.entity";

dotenv.config({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

describe("Driver and Admin Endpoints Integration", () => {
  const secret = process.env.JWT_SECRET || "ride_pooling_capstone_dev_secret_key_2026";
  let driverA: User;
  let driverB: User;
  let passenger: User;
  let admin: User;
  let driverAToken: string;
  let driverBToken: string;
  let passengerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    const userRepo = AppDataSource.getRepository(User);
    const vehicleRepo = AppDataSource.getRepository(Vehicle);

    // Clean up test users / vehicles
    await vehicleRepo.createQueryBuilder().delete().execute();
    await userRepo.createQueryBuilder().delete().execute();

    driverA = await userRepo.save(
      userRepo.create({
        email: "driver.a@test.com",
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: false,
      })
    );

    driverB = await userRepo.save(
      userRepo.create({
        email: "driver.b@test.com",
        password_hash: "hash",
        role: "DRIVER",
        driver_enabled: false,
      })
    );

    passenger = await userRepo.save(
      userRepo.create({
        email: "passenger@test.com",
        password_hash: "hash",
        role: "PASSENGER",
        driver_enabled: false,
      })
    );

    admin = await userRepo.save(
      userRepo.create({
        email: "admin@test.com",
        password_hash: "hash",
        role: "ADMIN",
        driver_enabled: false,
      })
    );

    driverAToken = jwt.sign({ sub: driverA.id, role: driverA.role }, secret);
    driverBToken = jwt.sign({ sub: driverB.id, role: driverB.role }, secret);
    passengerToken = jwt.sign({ sub: passenger.id, role: passenger.role }, secret);
    adminToken = jwt.sign({ sub: admin.id, role: admin.role }, secret);
  }, 30000);

  afterAll(async () => {
    const userRepo = AppDataSource.getRepository(User);
    const vehicleRepo = AppDataSource.getRepository(Vehicle);
    await vehicleRepo.createQueryBuilder().delete().execute();
    await userRepo.createQueryBuilder().delete().execute();

    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }, 30000);

  describe("POST /drivers/me/vehicles", () => {
    it("rejects unauthenticated requests with 401", async () => {
      const res = await request(app).post("/drivers/me/vehicles").send({
        description: "Toyota Corolla",
        registrationIdentifier: "REG-1234",
        seatCapacity: 4,
      });
      expect(res.status).toBe(401);
    });

    it("rejects non-driver roles with 403", async () => {
      const res = await request(app)
        .post("/drivers/me/vehicles")
        .set("Authorization", `Bearer ${passengerToken}`)
        .send({
          description: "Toyota Corolla",
          registrationIdentifier: "REG-1234",
          seatCapacity: 4,
        });
      expect(res.status).toBe(403);
    });

    it("registers a vehicle for driver A", async () => {
      const res = await request(app)
        .post("/drivers/me/vehicles")
        .set("Authorization", `Bearer ${driverAToken}`)
        .send({
          description: "Toyota Corolla Blue",
          registrationIdentifier: "REG-1234",
          seatCapacity: 4,
        });

      expect(res.status).toBe(201);
      expect(res.body.vehicleId).toBeDefined();
    });

    it("returns 409 when registrationIdentifier is already in use", async () => {
      const res = await request(app)
        .post("/drivers/me/vehicles")
        .set("Authorization", `Bearer ${driverBToken}`)
        .send({
          description: "Honda Civic",
          registrationIdentifier: "REG-1234",
          seatCapacity: 4,
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already registered/i);
    });
  });

  describe("GET /drivers/me/vehicles (Data Ownership)", () => {
    it("returns ONLY vehicles owned by calling driver", async () => {
      // Register a vehicle for driver B
      await request(app)
        .post("/drivers/me/vehicles")
        .set("Authorization", `Bearer ${driverBToken}`)
        .send({
          description: "Toyota Sienna",
          registrationIdentifier: "REG-9999",
          seatCapacity: 7,
        });

      // Driver A fetches vehicles
      const resA = await request(app)
        .get("/drivers/me/vehicles")
        .set("Authorization", `Bearer ${driverAToken}`);

      expect(resA.status).toBe(200);
      expect(resA.body).toHaveLength(1);
      expect(resA.body[0].registration_identifier).toBe("REG-1234");
      expect(resA.body[0].driver_id).toBe(driverA.id);

      // Driver B fetches vehicles
      const resB = await request(app)
        .get("/drivers/me/vehicles")
        .set("Authorization", `Bearer ${driverBToken}`);

      expect(resB.status).toBe(200);
      expect(resB.body).toHaveLength(1);
      expect(resB.body[0].registration_identifier).toBe("REG-9999");
      expect(resB.body[0].driver_id).toBe(driverB.id);
    });
  });

  describe("GET /admin/drivers?status=pending", () => {
    it("rejects non-admin roles with 403", async () => {
      const res = await request(app)
        .get("/admin/drivers?status=pending")
        .set("Authorization", `Bearer ${driverAToken}`);

      expect(res.status).toBe(403);
    });

    it("returns pending drivers for admin", async () => {
      const res = await request(app)
        .get("/admin/drivers?status=pending")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((d: any) => d.id === driverA.id)).toBe(true);
      expect(res.body.every((d: any) => d.driver_enabled === false)).toBe(true);
    });
  });

  describe("PATCH /admin/drivers/:id/enable", () => {
    it("enables a driver", async () => {
      const res = await request(app)
        .patch(`/admin/drivers/${driverA.id}/enable`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ enabled: true });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        driverId: driverA.id,
        enabled: true,
      });

      // Confirm in DB
      const userRepo = AppDataSource.getRepository(User);
      const updated = await userRepo.findOneBy({ id: driverA.id });
      expect(updated?.driver_enabled).toBe(true);
    });

    it("returns 404 if user is not a driver", async () => {
      const res = await request(app)
        .patch(`/admin/drivers/${passenger.id}/enable`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ enabled: true });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Driver not found");
    });
  });
});
