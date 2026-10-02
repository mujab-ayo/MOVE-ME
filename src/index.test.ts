import request from "supertest";
import app from "./app";
import { AppDataSource } from "./data-source";

afterAll(async () => {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
});

describe("GET /", () => {
  it("should redirect to /docs", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/docs");
  });
});

describe("GET /health", () => {
  it("should return status 200 and { status: 'ok' }", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("GET /docs", () => {
  it("should serve Swagger UI documentation at /docs", async () => {
    const res = await request(app).get("/docs");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("should serve Swagger UI documentation at /docs/", async () => {
    const res = await request(app).get("/docs/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("should return valid OpenAPI spec with 4 tags and documented routes at /docs.json", async () => {
    const res = await request(app).get("/docs.json");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\./);

    // Verify tag definitions
    const tagNames = res.body.tags.map((t: any) => t.name);
    expect(tagNames).toEqual(
      expect.arrayContaining(["Auth", "Vehicles", "Admin", "Departures"])
    );

    // Verify routes exist in paths
    const paths = res.body.paths;
    expect(paths["/auth/register/passenger"]).toBeDefined();
    expect(paths["/auth/register/passenger"].post.tags).toContain("Auth");

    expect(paths["/auth/register/driver"]).toBeDefined();
    expect(paths["/auth/register/driver"].post.tags).toContain("Auth");

    expect(paths["/auth/login"]).toBeDefined();
    expect(paths["/auth/login"].post.tags).toContain("Auth");

    expect(paths["/drivers/me/vehicles"]).toBeDefined();
    expect(paths["/drivers/me/vehicles"].post.tags).toContain("Vehicles");
    expect(paths["/drivers/me/vehicles"].get.tags).toContain("Vehicles");

    expect(paths["/admin/drivers"]).toBeDefined();
    expect(paths["/admin/drivers"].get.tags).toContain("Admin");

    expect(paths["/admin/drivers/{id}/enable"]).toBeDefined();
    expect(paths["/admin/drivers/{id}/enable"].patch.tags).toContain("Admin");

    expect(paths["/departures"]).toBeDefined();
    expect(paths["/departures"].post.tags).toContain("Departures");

    expect(paths["/departures/search"]).toBeDefined();
    expect(paths["/departures/search"].get.tags).toContain("Departures");
  });
});

