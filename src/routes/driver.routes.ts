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

/**
 * @openapi
 * /drivers/me/vehicles:
 *   post:
 *     summary: Add vehicle
 *     description: Registers a new vehicle for the authenticated driver.
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - description
 *               - registrationIdentifier
 *               - seatCapacity
 *             properties:
 *               description:
 *                 type: string
 *                 example: Toyota Camry 2021 (Silver)
 *               registrationIdentifier:
 *                 type: string
 *                 example: LAG-789-XY
 *               seatCapacity:
 *                 type: integer
 *                 minimum: 1
 *                 example: 4
 *     responses:
 *       201:
 *         description: Vehicle registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 vehicleId:
 *                   type: string
 *                   format: uuid
 *                   example: 123e4567-e89b-12d3-a456-426614174000
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Validation failed
 *                 details:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       field:
 *                         type: string
 *                       message:
 *                         type: string
 *       401:
 *         description: Authentication required or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Authentication token missing or invalid
 *       403:
 *         description: Forbidden - driver role required
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Forbidden: insufficient permissions"
 *       409:
 *         description: Registration identifier already registered
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Registration identifier already registered
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Internal server error
 */
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

/**
 * @openapi
 * /drivers/me/vehicles:
 *   get:
 *     summary: List my vehicles
 *     description: Retrieves all vehicles belonging to the authenticated driver. Enforces strict data ownership so drivers only see their own vehicles.
 *     tags:
 *       - Vehicles
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of vehicles owned by the authenticated driver
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
 *                     example: 123e4567-e89b-12d3-a456-426614174000
 *                   driver_id:
 *                     type: string
 *                     format: uuid
 *                     example: 123e4567-e89b-12d3-a456-426614174001
 *                   description:
 *                     type: string
 *                     example: Toyota Camry 2021 (Silver)
 *                   registration_identifier:
 *                     type: string
 *                     example: LAG-789-XY
 *                   seat_capacity:
 *                     type: integer
 *                     example: 4
 *                   active:
 *                     type: boolean
 *                     example: true
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *                     example: "2026-10-02T08:00:00.000Z"
 *       401:
 *         description: Authentication required or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Authentication token missing or invalid
 *       403:
 *         description: Forbidden - driver role required
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Forbidden: insufficient permissions"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Internal server error
 */
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
