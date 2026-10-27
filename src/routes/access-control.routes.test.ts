import request from "supertest";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import crypto from "crypto";
import app from "../app";
import { UserRole } from "../entities/user.entity";

dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env", quiet: true });

describe("Access Control & Role-Based Middleware Integration", () => {
  const secret = process.env.JWT_SECRET || "ride_pooling_capstone_dev_secret_key_2026";

  const createToken = (role: UserRole) => {
    return jwt.sign({ sub: crypto.randomUUID(), role }, secret);
  };

  interface TestCase {
    method: "get" | "post" | "patch";
    path: string;
    role: UserRole | null;
    status: 401 | 403;
    name: string;
  }

  const testCases: TestCase[] = [
    // GET /drivers/me/vehicles
    { method: "get", path: "/drivers/me/vehicles", role: null, status: 401, name: "GET /drivers/me/vehicles returns 401 without token" },
    { method: "get", path: "/drivers/me/vehicles", role: "PASSENGER", status: 403, name: "GET /drivers/me/vehicles returns 403 for PASSENGER" },
    { method: "get", path: "/drivers/me/vehicles", role: "ADMIN", status: 403, name: "GET /drivers/me/vehicles returns 403 for ADMIN" },

    // POST /drivers/me/vehicles
    { method: "post", path: "/drivers/me/vehicles", role: null, status: 401, name: "POST /drivers/me/vehicles returns 401 without token" },
    { method: "post", path: "/drivers/me/vehicles", role: "PASSENGER", status: 403, name: "POST /drivers/me/vehicles returns 403 for PASSENGER" },
    { method: "post", path: "/drivers/me/vehicles", role: "ADMIN", status: 403, name: "POST /drivers/me/vehicles returns 403 for ADMIN" },

    // GET /drivers/me/departures
    { method: "get", path: "/drivers/me/departures", role: null, status: 401, name: "GET /drivers/me/departures returns 401 without token" },
    { method: "get", path: "/drivers/me/departures", role: "PASSENGER", status: 403, name: "GET /drivers/me/departures returns 403 for PASSENGER" },
    { method: "get", path: "/drivers/me/departures", role: "ADMIN", status: 403, name: "GET /drivers/me/departures returns 403 for ADMIN" },

    // GET /admin/drivers
    { method: "get", path: "/admin/drivers", role: null, status: 401, name: "GET /admin/drivers returns 401 without token" },
    { method: "get", path: "/admin/drivers", role: "PASSENGER", status: 403, name: "GET /admin/drivers returns 403 for PASSENGER" },
    { method: "get", path: "/admin/drivers", role: "DRIVER", status: 403, name: "GET /admin/drivers returns 403 for DRIVER" },

    // PATCH /admin/drivers/:id/enable
    { method: "patch", path: "/admin/drivers/:id/enable", role: null, status: 401, name: "PATCH /admin/drivers/:id/enable returns 401 without token" },
    { method: "patch", path: "/admin/drivers/:id/enable", role: "PASSENGER", status: 403, name: "PATCH /admin/drivers/:id/enable returns 403 for PASSENGER" },
    { method: "patch", path: "/admin/drivers/:id/enable", role: "DRIVER", status: 403, name: "PATCH /admin/drivers/:id/enable returns 403 for DRIVER" },

    // POST /departures
    { method: "post", path: "/departures", role: null, status: 401, name: "POST /departures returns 401 without token" },
    { method: "post", path: "/departures", role: "PASSENGER", status: 403, name: "POST /departures returns 403 for PASSENGER" },
    { method: "post", path: "/departures", role: "ADMIN", status: 403, name: "POST /departures returns 403 for ADMIN" },

    // GET /departures/search
    { method: "get", path: "/departures/search", role: null, status: 401, name: "GET /departures/search returns 401 without token" },
    { method: "get", path: "/departures/search", role: "DRIVER", status: 403, name: "GET /departures/search returns 403 for DRIVER" },
    { method: "get", path: "/departures/search", role: "ADMIN", status: 403, name: "GET /departures/search returns 403 for ADMIN" },

    // POST /departures/:id/reservations
    { method: "post", path: "/departures/:id/reservations", role: null, status: 401, name: "POST /departures/:id/reservations returns 401 without token" },
    { method: "post", path: "/departures/:id/reservations", role: "DRIVER", status: 403, name: "POST /departures/:id/reservations returns 403 for DRIVER" },
    { method: "post", path: "/departures/:id/reservations", role: "ADMIN", status: 403, name: "POST /departures/:id/reservations returns 403 for ADMIN" },

    // POST /departures/:id/arrive
    { method: "post", path: "/departures/:id/arrive", role: null, status: 401, name: "POST /departures/:id/arrive returns 401 without token" },
    { method: "post", path: "/departures/:id/arrive", role: "PASSENGER", status: 403, name: "POST /departures/:id/arrive returns 403 for PASSENGER" },
    { method: "post", path: "/departures/:id/arrive", role: "ADMIN", status: 403, name: "POST /departures/:id/arrive returns 403 for ADMIN" },

    // POST /departures/:id/depart
    { method: "post", path: "/departures/:id/depart", role: null, status: 401, name: "POST /departures/:id/depart returns 401 without token" },
    { method: "post", path: "/departures/:id/depart", role: "PASSENGER", status: 403, name: "POST /departures/:id/depart returns 403 for PASSENGER" },
    { method: "post", path: "/departures/:id/depart", role: "ADMIN", status: 403, name: "POST /departures/:id/depart returns 403 for ADMIN" },

    // POST /departures/:id/complete
    { method: "post", path: "/departures/:id/complete", role: null, status: 401, name: "POST /departures/:id/complete returns 401 without token" },
    { method: "post", path: "/departures/:id/complete", role: "PASSENGER", status: 403, name: "POST /departures/:id/complete returns 403 for PASSENGER" },
    { method: "post", path: "/departures/:id/complete", role: "ADMIN", status: 403, name: "POST /departures/:id/complete returns 403 for ADMIN" },

    // POST /departures/:id/cancel
    { method: "post", path: "/departures/:id/cancel", role: null, status: 401, name: "POST /departures/:id/cancel returns 401 without token" },
    { method: "post", path: "/departures/:id/cancel", role: "PASSENGER", status: 403, name: "POST /departures/:id/cancel returns 403 for PASSENGER" },
    { method: "post", path: "/departures/:id/cancel", role: "ADMIN", status: 403, name: "POST /departures/:id/cancel returns 403 for ADMIN" },

    // POST /reservations/:id/payments
    { method: "post", path: "/reservations/:id/payments", role: null, status: 401, name: "POST /reservations/:id/payments returns 401 without token" },
    { method: "post", path: "/reservations/:id/payments", role: "DRIVER", status: 403, name: "POST /reservations/:id/payments returns 403 for DRIVER" },
    { method: "post", path: "/reservations/:id/payments", role: "ADMIN", status: 403, name: "POST /reservations/:id/payments returns 403 for ADMIN" },

    // POST /reservations/:id/cancel
    { method: "post", path: "/reservations/:id/cancel", role: null, status: 401, name: "POST /reservations/:id/cancel returns 401 without token" },
    { method: "post", path: "/reservations/:id/cancel", role: "DRIVER", status: 403, name: "POST /reservations/:id/cancel returns 403 for DRIVER" },
    { method: "post", path: "/reservations/:id/cancel", role: "ADMIN", status: 403, name: "POST /reservations/:id/cancel returns 403 for ADMIN" },

    // GET /passengers/me/reservations
    { method: "get", path: "/passengers/me/reservations", role: null, status: 401, name: "GET /passengers/me/reservations returns 401 without token" },
    { method: "get", path: "/passengers/me/reservations", role: "DRIVER", status: 403, name: "GET /passengers/me/reservations returns 403 for DRIVER" },
    { method: "get", path: "/passengers/me/reservations", role: "ADMIN", status: 403, name: "GET /passengers/me/reservations returns 403 for ADMIN" },

    // GET /passengers/me/notifications
    { method: "get", path: "/passengers/me/notifications", role: null, status: 401, name: "GET /passengers/me/notifications returns 401 without token" },
    { method: "get", path: "/passengers/me/notifications", role: "DRIVER", status: 403, name: "GET /passengers/me/notifications returns 403 for DRIVER" },
    { method: "get", path: "/passengers/me/notifications", role: "ADMIN", status: 403, name: "GET /passengers/me/notifications returns 403 for ADMIN" },

    // PATCH /notifications/:id/read
    { method: "patch", path: "/notifications/:id/read", role: null, status: 401, name: "PATCH /notifications/:id/read returns 401 without token" },
    { method: "patch", path: "/notifications/:id/read", role: "DRIVER", status: 403, name: "PATCH /notifications/:id/read returns 403 for DRIVER" },
    { method: "patch", path: "/notifications/:id/read", role: "ADMIN", status: 403, name: "PATCH /notifications/:id/read returns 403 for ADMIN" },

    // requireAuth only endpoints
    { method: "get", path: "/reservations/:id", role: null, status: 401, name: "GET /reservations/:id returns 401 without token" },
    { method: "get", path: "/payments/:id", role: null, status: 401, name: "GET /payments/:id returns 401 without token" },
    { method: "get", path: "/routes", role: null, status: 401, name: "GET /routes returns 401 without token" },
  ];

  test.each(testCases)("$name", async ({ method, path: epPath, role, status }) => {
    const testPath = epPath.replace(":id", crypto.randomUUID());
    let req = (request(app) as any)[method](testPath);

    if (role !== null) {
      const token = createToken(role);
      req = req.set("Authorization", `Bearer ${token}`);
    }

    const res = await req;
    expect(res.status).toBe(status);

    if (status === 401) {
      expect(res.body).toEqual({
        error: "Authentication token missing or invalid",
      });
    } else {
      expect(res.body).toEqual({
        error: "Forbidden: insufficient permissions",
      });
    }
  });
});
