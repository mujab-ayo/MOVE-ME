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
 *     summary: Register a new vehicle for the authenticated driver (DRIVER role only).
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
 *               registrationIdentifier:
 *                 type: string
 *               seatCapacity:
 *                 type: integer
 *                 minimum: 1
 *           example:
 *             description: "Toyota Camry 2021 (Silver)"
 *             registrationIdentifier: "LAG-789-XY"
 *             seatCapacity: 4
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
 *             example:
 *               vehicleId: "123e4567-e89b-12d3-a456-426614174000"
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Validation failed"
 *       401:
 *         description: Authentication required or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Authentication token missing or invalid"
 *       403:
 *         description: Forbidden - driver role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Forbidden: insufficient permissions"
 *       409:
 *         description: Registration identifier already registered
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Registration identifier already registered"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Internal server error"
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
      throw err;
    }
  }
);

/**
 * @openapi
 * /drivers/me/vehicles:
 *   get:
 *     summary: Retrieve all vehicles owned by the authenticated driver (DRIVER role only).
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
 *                   driver_id:
 *                     type: string
 *                     format: uuid
 *                   description:
 *                     type: string
 *                   registration_identifier:
 *                     type: string
 *                   seat_capacity:
 *                     type: integer
 *                   active:
 *                     type: boolean
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *             example:
 *               - id: "123e4567-e89b-12d3-a456-426614174000"
 *                 driver_id: "123e4567-e89b-12d3-a456-426614174001"
 *                 description: "Toyota Camry 2021 (Silver)"
 *                 registration_identifier: "LAG-789-XY"
 *                 seat_capacity: 4
 *                 active: true
 *                 created_at: "2026-10-02T08:00:00.000Z"
 *       401:
 *         description: Authentication required or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Authentication token missing or invalid"
 *       403:
 *         description: Forbidden - driver role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Forbidden: insufficient permissions"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Internal server error"
 */
// GET /drivers/me/vehicles - list vehicles belonging to authenticated driver
router.get(
  "/me/vehicles",
  requireAuth,
  requireRole("DRIVER"),
  async (req: Request, res: Response): Promise<void> => {
    // Data ownership requirement (Week 2 rubric competency):
    // Filtering by driver_id = req.user.id is a strict authorization/data-ownership boundary,
    // NOT an optional search filter. Drivers must only ever see and manage their own vehicles.
    const vehicles = await vehicleRepository.find({
      where: { driver_id: req.user!.id },
      order: { created_at: "DESC" },
    });

    res.status(200).json(vehicles);
  }
);

/**
 * @openapi
 * /drivers/me/departures:
 *   get:
 *     summary: List all departures published by the authenticated driver (DRIVER role only).
 *     description: Retrieves all departures published by the authenticated driver, ordered soonest first (departure_time ASC). Each item includes status, mode, departure_time, capacity, available_capacity, and counts of confirmed and pending reservations.
 *     tags:
 *       - Departures
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of departures owned by caller
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
 *                   status:
 *                     type: string
 *                   mode:
 *                     type: string
 *                   departure_time:
 *                     type: string
 *                     format: date-time
 *                   capacity:
 *                     type: integer
 *                   available_capacity:
 *                     type: integer
 *                   confirmed_reservations:
 *                     type: integer
 *                   pending_reservations:
 *                     type: integer
 *             example:
 *               - id: "123e4567-e89b-12d3-a456-426614174000"
 *                 driver_id: "123e4567-e89b-12d3-a456-426614174001"
 *                 vehicle_id: "123e4567-e89b-12d3-a456-426614174002"
 *                 route_id: "123e4567-e89b-12d3-a456-426614174003"
 *                 status: "SCHEDULED"
 *                 mode: "POOLED"
 *                 departure_time: "2026-11-01T08:00:00.000Z"
 *                 duration_minutes: 60
 *                 fare_amount: "25.00"
 *                 capacity: 4
 *                 available_capacity: 3
 *                 confirmed_reservations: 1
 *                 pending_reservations: 0
 *                 pickup_point: "Downtown Station"
 *                 dropoff_point: "Airport Terminal"
 *                 vehicle_description: "Toyota Camry 2021 (Silver)"
 *                 vehicle_registration: "LAG-789-XY"
 *                 created_at: "2026-10-25T10:00:00.000Z"
 *       401:
 *         description: Authentication required or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Authentication token missing or invalid"
 *       403:
 *         description: Forbidden - driver role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Forbidden: insufficient permissions"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Internal server error"
 */
router.get(
  "/me/departures",
  requireAuth,
  requireRole("DRIVER"),
  async (req: Request, res: Response): Promise<void> => {
    const driverId = req.user!.id;

    const rows = await AppDataSource.query(
        `SELECT
           d.id,
           d.driver_id,
           d.vehicle_id,
           d.route_id,
           d.status,
           d.mode,
           d.departure_time,
           d.duration_minutes,
           d.fare_amount,
           d.capacity,
           d.created_at,
           d.arrived_at,
           d.departed_at,
           d.completed_at,
           d.cancelled_at,
           d.cancellation_reason,
           r.pickup_point,
           r.dropoff_point,
           v.description AS vehicle_description,
           v.registration_identifier AS vehicle_registration,
           COALESCE(conf.cnt, 0)::int AS confirmed_reservations,
           COALESCE(pend.cnt, 0)::int AS pending_reservations,
           (d.capacity - COALESCE(active.cnt, 0))::int AS available_capacity
         FROM departures d
         LEFT JOIN routes r ON d.route_id = r.id
         LEFT JOIN vehicles v ON d.vehicle_id = v.id
         LEFT JOIN (
           SELECT departure_id, count(*)::int AS cnt
           FROM reservations
           WHERE status = 'CONFIRMED'
           GROUP BY departure_id
         ) conf ON conf.departure_id = d.id
         LEFT JOIN (
           SELECT departure_id, count(*)::int AS cnt
           FROM reservations
           WHERE status = 'PENDING_PAYMENT' AND hold_expires_at > now()
           GROUP BY departure_id
         ) pend ON pend.departure_id = d.id
         LEFT JOIN (
           SELECT departure_id, count(*)::int AS cnt
           FROM reservations
           WHERE status = 'CONFIRMED' OR (status = 'PENDING_PAYMENT' AND hold_expires_at > now())
           GROUP BY departure_id
         ) active ON active.departure_id = d.id
         WHERE d.driver_id = $1
         ORDER BY d.departure_time ASC;`,
        [driverId]
      );

      const departures = rows.map((row: any) => ({
        id: row.id,
        driver_id: row.driver_id,
        driverId: row.driver_id,
        vehicle_id: row.vehicle_id,
        vehicleId: row.vehicle_id,
        route_id: row.route_id,
        routeId: row.route_id,
        status: row.status,
        mode: row.mode,
        departure_time: row.departure_time,
        departureTime: row.departure_time,
        duration_minutes: row.duration_minutes,
        durationMinutes: row.duration_minutes,
        fare_amount: row.fare_amount,
        fareAmount: row.fare_amount,
        capacity: row.capacity,
        available_capacity: row.available_capacity,
        availableCapacity: row.available_capacity,
        confirmed_reservations: row.confirmed_reservations,
        confirmedReservations: row.confirmed_reservations,
        pending_reservations: row.pending_reservations,
        pendingReservations: row.pending_reservations,
        pickup_point: row.pickup_point,
        pickupPoint: row.pickup_point,
        dropoff_point: row.dropoff_point,
        dropoffPoint: row.dropoff_point,
        vehicle_description: row.vehicle_description,
        vehicle_registration: row.vehicle_registration,
        created_at: row.created_at,
        arrived_at: row.arrived_at,
        departed_at: row.departed_at,
        completed_at: row.completed_at,
        cancelled_at: row.cancelled_at,
        cancellation_reason: row.cancellation_reason,
      }));

      res.status(200).json(departures);
  }
);

export default router;
