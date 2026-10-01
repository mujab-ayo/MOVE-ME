import express, { Request, Response } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { requireAuth, requireRole } from "./auth.middleware";

dotenv.config({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

describe("Auth Middleware", () => {
  const secret = process.env.JWT_SECRET || "test_secret";
  const app = express();
  app.use(express.json());

  app.get("/protected", requireAuth, (req: Request, res: Response) => {
    res.status(200).json({ user: req.user });
  });

  app.get(
    "/driver-only",
    requireAuth,
    requireRole("DRIVER"),
    (req: Request, res: Response) => {
      res.status(200).json({ message: "Welcome Driver" });
    }
  );

  app.get(
    "/admin-only",
    requireAuth,
    requireRole("ADMIN"),
    (req: Request, res: Response) => {
      res.status(200).json({ message: "Welcome Admin" });
    }
  );

  describe("requireAuth", () => {
    it("returns 401 if Authorization header is missing", async () => {
      const res = await request(app).get("/protected");
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/missing or invalid/i);
    });

    it("returns 401 if Authorization header is malformed", async () => {
      const res = await request(app)
        .get("/protected")
        .set("Authorization", "InvalidHeaderFormat");
      expect(res.status).toBe(401);
    });

    it("returns 401 if token is invalid", async () => {
      const res = await request(app)
        .get("/protected")
        .set("Authorization", "Bearer invalid.token.here");
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid or expired/i);
    });

    it("attaches req.user { id, role } and calls next() on valid token", async () => {
      const token = jwt.sign(
        { sub: "123e4567-e89b-12d3-a456-426614174000", role: "PASSENGER" },
        secret
      );

      const res = await request(app)
        .get("/protected")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.user).toEqual({
        id: "123e4567-e89b-12d3-a456-426614174000",
        role: "PASSENGER",
      });
    });
  });

  describe("requireRole", () => {
    it("returns 403 if user role is not in the allowed list", async () => {
      const passengerToken = jwt.sign(
        { sub: "user-passenger-id", role: "PASSENGER" },
        secret
      );

      const res = await request(app)
        .get("/driver-only")
        .set("Authorization", `Bearer ${passengerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/insufficient permissions/i);
    });

    it("allows access if user role matches allowed roles", async () => {
      const driverToken = jwt.sign(
        { sub: "user-driver-id", role: "DRIVER" },
        secret
      );

      const res = await request(app)
        .get("/driver-only")
        .set("Authorization", `Bearer ${driverToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Welcome Driver");
    });
  });
});
