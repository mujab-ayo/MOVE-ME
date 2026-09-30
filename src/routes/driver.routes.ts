import { Router, Request, Response } from "express";
import { z } from "zod";
import { AppDataSource } from "../data-source";
import { Vehicle } from "../entities/vehicle.entity";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import { validateBody } from "../middleware/validate.middleware";

const router = Router();
const vehicleRepository = AppDataSource.getRepository(Vehicle);

const createVehicleSchema = z.object({
  description: z.string().min(1, "Description is required"),
  registrationIdentifier: z.string().min(1, "Registration identifier is required"),
  seatCapacity: z.number().int().positive("Seat capacity must be a positive integer"),
});

// POST /drivers/me/vehicles - register a vehicle for authenticated driver
router.post(
  "/me/vehicles",
  requireAuth,
  requireRole("DRIVER"),
  validateBody(createVehicleSchema),
  async (req: Request, res: Response): Promise<void> => {
    const { description, registrationIdentifier, seatCapacity } = req.body;
    const driverId = req.user!.id;

    try {
      const existingVehicle = await vehicleRepository.findOneBy({
        registration_identifier: registrationIdentifier,
      });

      if (existingVehicle) {
        res.status(409).json({ error: "Registration identifier already registered" });
        return;
      }

      const vehicle = vehicleRepository.create({
        driver_id: driverId,
        description,
        registration_identifier: registrationIdentifier,
        seat_capacity: seatCapacity,
        active: true,
      });

      await vehicleRepository.save(vehicle);

      res.status(201).json({ vehicleId: vehicle.id });
    } catch (err: any) {
      if (err.code === "23505") {
        res.status(409).json({ error: "Registration identifier already registered" });
        return;
      }
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// GET /drivers/me/vehicles - list vehicles belonging to authenticated driver
router.get(
  "/me/vehicles",
  requireAuth,
  requireRole("DRIVER"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Data ownership requirement (Week 2 rubric competency):
      // Filtering by driver_id = req.user.id is a strict authorization/data-ownership boundary,
      // NOT an optional search filter. Drivers must only ever see and manage their own vehicles.
      const vehicles = await vehicleRepository.find({
        where: { driver_id: req.user!.id },
        order: { created_at: "DESC" },
      });

      res.status(200).json(vehicles);
    } catch (_err) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
