import { Router, Request, Response } from "express";
import { z } from "zod";
import { AppDataSource } from "../data-source";
import { Departure } from "../entities/departure.entity";
import { User } from "../entities/user.entity";
import { Vehicle } from "../entities/vehicle.entity";
import { Route } from "../entities/route.entity";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import { validateBody } from "../middleware/validate.middleware";

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
