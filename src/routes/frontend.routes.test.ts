import request from "supertest";
import app from "../app";
import { AppDataSource } from "../data-source";

afterAll(async () => {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
});

describe("Frontend routes", () => {
  it("GET /app/ returns 200 and HTML containing the app name", async () => {
    const res = await request(app).get("/app/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("MoveMe");
  });

  it("GET /app/js/api.js returns 200 with a JavaScript content type", async () => {
    const res = await request(app).get("/app/js/api.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/javascript/);
  });

  it("GET /app/missing.js returns the JSON 404 {error: \"Not found\"}", async () => {
    const res = await request(app).get("/app/missing.js");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("GET / still redirects to /docs", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/docs");
  });
});
