import request from "supertest";
import app from "./app";
import { AppDataSource } from "./data-source";

afterAll(async () => {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
});

describe("GET /health", () => {
  it("should return status 200 and { status: 'ok' }", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
