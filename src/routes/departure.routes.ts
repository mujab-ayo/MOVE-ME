import { Router, Request, Response } from "express";
import { z } from "zod";
import { AppDataSource } from "../data-source";
import { Departure } from "../entities/departure.entity";
import { User } from "../entities/user.entity";
import { Vehicle } from "../entities/vehicle.entity";
import { Route } from "../entities/route.entity";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import { validateBody, validateQuery } from "../middleware/validate.middleware";

const router = Router();
const departureRepository = AppDataSource.getRepository(Departure);
const userRepository = AppDataSource.getRepository(User);
const vehicleRepository = AppDataSource.getRepository(Vehicle);
const routeRepository = AppDataSource.getRepository(Route);

const createDepartureSchema = z.object({
  vehicleId: z.string().uuid("Invalid vehicle ID format"),
  routeId: z.string().uuid("Invalid route ID format"),
  mode: z.enum(["SOLO", "POOLED"]),
  departureTime: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: "Invalid ISO departure time",
  }),
});

const searchDeparturesQuerySchema = z
  .object({
    routeId: z.string().uuid("Invalid route ID format"),
    mode: z.enum(["SOLO", "POOLED"]),
    when: z.enum(["immediate", "scheduled"]),
    datetime: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.when === "scheduled") {
      if (!data.datetime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["datetime"],
          message: "datetime is required when when='scheduled'",
        });
      } else if (isNaN(Date.parse(data.datetime))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["datetime"],
          message: "Invalid ISO datetime",
        });
      }
    }
  });

// GET /departures/search - search departures (immediate vs scheduled)
router.get(
  "/search",
  requireAuth,
  requireRole("PASSENGER"),
  validateQuery(searchDeparturesQuerySchema),
  async (req: Request, res: Response): Promise<void> => {
    const { routeId, mode, when, datetime } = req.query as {
      routeId: string;
      mode: "SOLO" | "POOLED";
      when: "immediate" | "scheduled";
      datetime?: string;
    };

    try {
      const qb = departureRepository
        .createQueryBuilder("departure")
        .innerJoinAndSelect("departure.route", "route")
        .innerJoinAndSelect("departure.driver", "driver")
        .where("departure.route_id = :routeId", { routeId })
        .andWhere("departure.mode = :mode", { mode })
        .andWhere("departure.status = :status", { status: "SCHEDULED" });

      if (when === "immediate") {
        const now = new Date();
        const windowEnd = new Date(now.getTime() + 15 * 60 * 1000);
        qb.andWhere(
          "departure.departure_time >= :now AND departure.departure_time <= :windowEnd",
          { now, windowEnd }
        );
        qb.orderBy("departure.departure_time", "ASC");
      } else {
        const targetDate = new Date(datetime!);
        qb.andWhere(
          "departure.departure_time >= :targetDate AND departure.departure_time > now()",
          { targetDate }
        );
        qb.orderBy("departure.departure_time", "ASC");
        qb.take(20);
      }

      const departures = await qb.getMany();

      const results = departures.map((dep) => {
        // TODO: available_capacity needs a live count against the reservations table, which doesn't exist until Week 4's booking prompt — for now just return the departure's raw capacity.
        const availableCapacity = dep.capacity;

        const driverName =
          (dep.driver as any)?.full_name ||
          (dep.driver as any)?.fullName ||
          dep.driver?.email ||
          "";

        return {
          id: dep.id,
          departureId: dep.id,
          route_id: dep.route_id,
          routeId: dep.route_id,
          pickup_point: dep.route?.pickup_point,
          pickupPoint: dep.route?.pickup_point,
          dropoff_point: dep.route?.dropoff_point,
          dropoffPoint: dep.route?.dropoff_point,
          departure_time: dep.departure_time,
          departureTime: dep.departure_time,
          driver_name: driverName,
          driverName: driverName,
          driver: driverName,
          fare_amount: dep.fare_amount,
          fareAmount: dep.fare_amount,
          mode: dep.mode,
          capacity: dep.capacity,
          available_capacity: availableCapacity,
          availableCapacity: availableCapacity,
        };
      });

      res.status(200).json({
        results,
        empty: results.length === 0,
      });
    } catch (_err) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// POST /departures - publish a departure (driver only, gate-checked)
router.post(
  "/",
  requireAuth,
  requireRole("DRIVER"),
  validateBody(createDepartureSchema),
  async (req: Request, res: Response): Promise<void> => {
    const { vehicleId, routeId, mode, departureTime } = req.body;
    const driverId = req.user!.id;

    try {
      // 1. Driver must be enabled
      const driver = await userRepository.findOneBy({ id: driverId });
      if (!driver || !driver.driver_enabled) {
        res.status(403).json({ error: "Driver is not enabled to publish departures" });
        return;
      }

      // 2. Vehicle must belong to this driver and be active
      const vehicle = await vehicleRepository.findOneBy({ id: vehicleId, active: true });
      if (!vehicle || vehicle.driver_id !== driverId) {
        res.status(403).json({ error: "Vehicle does not belong to driver" });
        return;
      }

      // 3. Route must exist and be active
      const route = await routeRepository.findOneBy({ id: routeId, active: true });
      if (!route) {
        res.status(404).json({ error: "Route not found" });
        return;
      }

      // 4. Snapshot duration and fare per mode
      const durationMinutes = route.base_duration_minutes;
      const fareAmount =
        mode === "SOLO" ? route.base_fare_solo : route.base_fare_per_seat;

      // 5. Capacity: 1 if SOLO, else vehicle's seat_capacity
      const capacity = mode === "SOLO" ? 1 : vehicle.seat_capacity;

      // 6. Insert departure — let database EXCLUDE constraints do overlap rejection
      const departure = departureRepository.create({
        driver_id: driverId,
        vehicle_id: vehicle.id,
        route_id: route.id,
        mode,
        departure_time: new Date(departureTime),
        duration_minutes: durationMinutes,
        fare_amount: fareAmount,
        capacity,
        status: "SCHEDULED",
      });

      await departureRepository.save(departure);

      res.status(201).json({
        departureId: departure.id,
        capacity: departure.capacity,
        fareAmount: departure.fare_amount,
        durationMinutes: departure.duration_minutes,
        status: departure.status,
      });
    } catch (err: any) {
      // Postgres error code 23P01 is exclusion_violation from EXCLUDE USING gist
      if (err.code === "23P01") {
        res.status(409).json({
          error: "Overlapping departure detected for this driver or vehicle",
        });
        return;
      }

      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
