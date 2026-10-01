import request from "supertest";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import argon2 from "argon2";
import app from "../app";
import { AppDataSource } from "../data-source";
import { User } from "../entities/user.entity";

dotenv.config({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

describe("Auth Endpoints Integration", () => {
  const secret = process.env.JWT_SECRET || "ride_pooling_capstone_dev_secret_key_2026";

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
  });

  afterAll(async () => {
    const userRepo = AppDataSource.getRepository(User);
    await userRepo.delete({ email: "newpassenger@test.com" });
    await userRepo.delete({ email: "newdriver@test.com" });
    await userRepo.delete({ email: "newadmin@test.com" });
    await userRepo.delete({ email: "newlegacyadmin@test.com" });

    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  });

  describe("POST /auth/register/passenger", () => {
    it("registers a new passenger and returns 201 with userId", async () => {
      const res = await request(app).post("/auth/register/passenger").send({
        email: "newpassenger@test.com",
        password: "SecretPassword123",
      });

      expect(res.status).toBe(201);
      expect(res.body.userId).toBeDefined();
    });

    it("returns 409 if email is already taken", async () => {
      const res = await request(app).post("/auth/register/passenger").send({
        email: "newpassenger@test.com",
        password: "SecretPassword123",
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already registered/i);
    });

    it("returns 400 on invalid input", async () => {
      const res = await request(app).post("/auth/register/passenger").send({
        email: "not-an-email",
        password: "123",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
    });
  });

  describe("POST /auth/register/driver", () => {
    it("registers a new driver and returns 201 with userId and driverEnabled: false", async () => {
      const res = await request(app).post("/auth/register/driver").send({
        email: "newdriver@test.com",
        password: "SecretPassword123",
      });

      expect(res.status).toBe(201);
      expect(res.body.userId).toBeDefined();
      expect(res.body.driverEnabled).toBe(false);
    });
  });

  describe("POST /auth/login", () => {
    it("returns 200 with JWT containing sub and role ONLY", async () => {
      const res = await request(app).post("/auth/login").send({
        email: "newdriver@test.com",
        password: "SecretPassword123",
      });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.role).toBe("DRIVER");

      const decoded = jwt.verify(res.body.accessToken, secret) as any;
      expect(decoded.sub).toBeDefined();
      expect(decoded.role).toBe("DRIVER");
      expect(decoded.driver_enabled).toBeUndefined();
      expect(decoded.driverEnabled).toBeUndefined();
    });

    it("returns 401 on incorrect password", async () => {
      const res = await request(app).post("/auth/login").send({
        email: "newdriver@test.com",
        password: "WrongPassword",
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid email or password/i);
    });

    it("returns 401 on non-existent email", async () => {
      const res = await request(app).post("/auth/login").send({
        email: "nonexistent@test.com",
        password: "SecretPassword123",
      });

      expect(res.status).toBe(401);
    });

    it("returns 200 with JWT containing sub and role ONLY for ADMIN login", async () => {
      const userRepo = AppDataSource.getRepository(User);
      const adminPassword = "AdminSecretPassword123";
      const adminHash = await argon2.hash(adminPassword);

      await userRepo.save(
        userRepo.create({
          email: "newadmin@test.com",
          password_hash: adminHash,
          role: "ADMIN",
          driver_enabled: false,
        })
      );

      const res = await request(app).post("/auth/login").send({
        email: "newadmin@test.com",
        password: adminPassword,
      });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.role).toBe("ADMIN");

      const decoded = jwt.verify(res.body.accessToken, secret) as any;
      expect(decoded.sub).toBeDefined();
      expect(decoded.role).toBe("ADMIN");
      expect(decoded.driver_enabled).toBeUndefined();
      expect(decoded.driverEnabled).toBeUndefined();
    });

    it("returns 401 via catch when stored hash is malformed (e.g. missing parallelism)", async () => {
      const userRepo = AppDataSource.getRepository(User);
      await userRepo.save(
        userRepo.create({
          email: "newlegacyadmin@test.com",
          password_hash: "$argon2id$v=19$m=65536,t=3$nRWB8RmQ9cQPsBRngSTt9Q$2hN8F1XxRQf+62k444j8cFeRbK6tHudQ/JS5LDkMviE",
          role: "ADMIN",
          driver_enabled: false,
        })
      );

      const res = await request(app).post("/auth/login").send({
        email: "newlegacyadmin@test.com",
        password: "SecretPassword123",
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid email or password/i);
    });
  });
});
