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

/**
 * @openapi
 * /departures/search:
 *   get:
 *     summary: Search scheduled departures by route, mode, and timing (PASSENGER role only).
 *     description: Searches scheduled departures by route, mode, and timing. Immediate mode looks for departures within 15 minutes from now. Scheduled mode queries departures matching or after the given datetime. Requires PASSENGER role.
 *     tags:
 *       - Departures
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: routeId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: UUID of the target route
 *       - in: query
 *         name: mode
 *         required: true
 *         schema:
 *           type: string
 *           enum:
 *             - SOLO
 *             - POOLED
 *         description: Desired ride mode
 *       - in: query
 *         name: when
 *         required: true
 *         schema:
 *           type: string
 *           enum:
 *             - immediate
 *             - scheduled
 *         description: Search window type (immediate = next 15 mins, scheduled = target datetime)
 *       - in: query
 *         name: datetime
 *         required: false
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Required when when=scheduled. Target departure ISO datetime.
 *     responses:
 *       200:
 *         description: Search results containing available departures
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       departureId:
 *                         type: string
 *                         format: uuid
 *                       route_id:
 *                         type: string
 *                         format: uuid
 *                       routeId:
 *                         type: string
 *                         format: uuid
 *                       pickup_point:
 *                         type: string
 *                       pickupPoint:
 *                         type: string
 *                       dropoff_point:
 *                         type: string
 *                       dropoffPoint:
 *                         type: string
 *                       departure_time:
 *                         type: string
 *                         format: date-time
 *                       departureTime:
 *                         type: string
 *                         format: date-time
 *                       driver_name:
 *                         type: string
 *                       driverName:
 *                         type: string
 *                       driver:
 *                         type: string
 *                       fare_amount:
 *                         type: string
 *                       fareAmount:
 *                         type: string
 *                       mode:
 *                         type: string
 *                       capacity:
 *                         type: integer
 *                       available_capacity:
 *                         type: integer
 *                       availableCapacity:
 *                         type: integer
 *                 empty:
 *                   type: boolean
 *             example:
 *               results:
 *                 - id: "123e4567-e89b-12d3-a456-426614174000"
 *                   departureId: "123e4567-e89b-12d3-a456-426614174000"
 *                   route_id: "123e4567-e89b-12d3-a456-426614174001"
 *                   routeId: "123e4567-e89b-12d3-a456-426614174001"
 *                   pickup_point: "Ikeja Bus Terminal"
 *                   pickupPoint: "Ikeja Bus Terminal"
 *                   dropoff_point: "Victoria Island (Eko Hotel)"
 *                   dropoffPoint: "Victoria Island (Eko Hotel)"
 *                   departure_time: "2026-11-01T12:00:00.000Z"
 *                   departureTime: "2026-11-01T12:00:00.000Z"
 *                   driver_name: "John Driver"
 *                   driverName: "John Driver"
 *                   driver: "John Driver"
 *                   fare_amount: "5000.00"
 *                   fareAmount: "5000.00"
 *                   mode: "SOLO"
 *                   capacity: 1
 *                   available_capacity: 1
 *                   availableCapacity: 1
 *               empty: false
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
 *         description: Forbidden - passenger role required
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

    const qb = departureRepository
      .createQueryBuilder("departure")
        .innerJoinAndSelect("departure.route", "route")
        .innerJoinAndSelect("departure.driver", "driver")
        .where("departure.route_id = :routeId", { routeId })
        .andWhere("departure.mode = :mode", { mode })
        .andWhere("departure.status = :status", { status: "SCHEDULED" });

      // Live available_capacity calculation:
      // available_capacity = capacity - count of reservations where status = 'CONFIRMED' OR (status = 'PENDING_PAYMENT' AND hold_expires_at > now())
      const activeReservationsSubquery = `COALESCE((
        SELECT count(*)::int
        FROM reservations r
        WHERE r.departure_id = departure.id
          AND (r.status = 'CONFIRMED'
               OR (r.status = 'PENDING_PAYMENT' AND r.hold_expires_at > now()))
      ), 0)`;

      const availableCapacityExpr = `(departure.capacity - ${activeReservationsSubquery})`;

      qb.addSelect(availableCapacityExpr, "available_capacity");
      // Exclude departures with available_capacity <= 0 (a full departure is not eligible)
      qb.andWhere(`${availableCapacityExpr} > 0`);

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

      const { entities: departures, raw } = await qb.getRawAndEntities();

      const availableCapacityMap = new Map<string, number>();
      for (const r of raw) {
        const depId = r.departure_id || r.id;
        const rawAvail = r.available_capacity ?? r.availableCapacity;
        if (depId && rawAvail !== undefined) {
          availableCapacityMap.set(depId, parseInt(rawAvail, 10));
        }
      }

      const results = departures.map((dep, idx) => {
        const availableCapacity =
          availableCapacityMap.get(dep.id) ??
          (raw[idx] && (raw[idx].available_capacity ?? raw[idx].availableCapacity) !== undefined
            ? parseInt(raw[idx].available_capacity ?? raw[idx].availableCapacity, 10)
            : dep.capacity);

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
  }
);

/**
 * @openapi
 * /departures:
 *   post:
 *     summary: Publish a new scheduled departure (DRIVER role only, driver must be enabled).
 *     description: Publishes a new departure. Requires DRIVER role, driver must be enabled (driver_enabled=true), vehicle must belong to the driver and be active, and route must exist and be active. Prevents overlapping departures via database exclusion constraints.
 *     tags:
 *       - Departures
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - vehicleId
 *               - routeId
 *               - mode
 *               - departureTime
 *             properties:
 *               vehicleId:
 *                 type: string
 *                 format: uuid
 *               routeId:
 *                 type: string
 *                 format: uuid
 *               mode:
 *                 type: string
 *                 enum:
 *                   - SOLO
 *                   - POOLED
 *               departureTime:
 *                 type: string
 *                 format: date-time
 *           example:
 *             vehicleId: "123e4567-e89b-12d3-a456-426614174000"
 *             routeId: "7b13bc6e-19d2-4e89-b7e1-8cbdf6a92892"
 *             mode: "SOLO"
 *             departureTime: "2026-11-01T12:00:00.000Z"
 *     responses:
 *       201:
 *         description: Departure published successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 departureId:
 *                   type: string
 *                   format: uuid
 *                 capacity:
 *                   type: integer
 *                 fareAmount:
 *                   type: string
 *                 durationMinutes:
 *                   type: integer
 *                 status:
 *                   type: string
 *             example:
 *               departureId: "123e4567-e89b-12d3-a456-426614174000"
 *               capacity: 1
 *               fareAmount: "5000.00"
 *               durationMinutes: 45
 *               status: "SCHEDULED"
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
 *         description: Driver not enabled or vehicle does not belong to driver
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Driver is not enabled to publish departures"
 *       404:
 *         description: Route not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Route not found"
 *       409:
 *         description: Overlapping departure detected
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Overlapping departure detected for this driver or vehicle"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Internal server error"
 */
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

      throw err;
    }
  }
);

export const HOLD_MINUTES = parseFloat(process.env.HOLD_MINUTES || "5");

/**
 * @openapi
 * /departures/{id}/reservations:
 *   post:
 *     summary: Reserve a seat on a scheduled departure (PASSENGER role only).
 *     description: Reserves a seat on a scheduled departure using the capacity-guard transaction. Holds capacity for 5 minutes (HOLD_MINUTES) in PENDING_PAYMENT status. Identical code path for SOLO and POOLED departures. Requires PASSENGER role.
 *     tags:
 *       - Bookings
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Departure UUID to reserve
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *           example: {}
 *     responses:
 *       201:
 *         description: Reservation created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 reservationId:
 *                   type: string
 *                   format: uuid
 *                 status:
 *                   type: string
 *                 holdExpiresAt:
 *                   type: string
 *                   format: date-time
 *                 fareAmount:
 *                   type: string
 *             example:
 *               reservationId: "123e4567-e89b-12d3-a456-426614174000"
 *               status: "PENDING_PAYMENT"
 *               holdExpiresAt: "2026-11-01T12:05:00.000Z"
 *               fareAmount: "2500.00"
 *       400:
 *         description: Invalid departure ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Invalid departure ID format"
 *       401:
 *         description: Authentication required or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Authentication token missing or invalid"
 *       403:
 *         description: Forbidden - passenger role required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Forbidden: insufficient permissions"
 *       404:
 *         description: Departure not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Departure not found"
 *       409:
 *         description: Departure ineligible, no capacity, or duplicate active reservation
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "No available capacity on this departure"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Internal server error"
 */
// POST /departures/:id/reservations - reserve a seat (capacity-guard transaction)
router.post(
  "/:id/reservations",
  requireAuth,
  requireRole("PASSENGER"),
  async (req: Request, res: Response): Promise<void> => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!z.string().uuid().safeParse(id).success) {
      res.status(400).json({ error: "Invalid departure ID format" });
      return;
    }

    const passengerId = req.user!.id;
    const holdMinutes = parseFloat(process.env.HOLD_MINUTES || "5");

    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Serializes all concurrent attempts on this departure.
      const departures = await queryRunner.query(
        `SELECT id, capacity, status, departure_time, fare_amount
         FROM departures
         WHERE id = $1
         FOR UPDATE;`,
        [id]
      );

      if (departures.length === 0) {
        await queryRunner.rollbackTransaction();
        res.status(404).json({ error: "Departure not found" });
        return;
      }

      const departure = departures[0];

      // 2. Opportunistically expire the caller's OWN stale hold on this departure
      // (if any), so a genuinely-expired attempt never blocks their retry,
      // without needing any global sweep.
      await queryRunner.query(
        `UPDATE reservations
         SET status = 'EXPIRED'
         WHERE departure_id = $1 AND passenger_id = $2
           AND status = 'PENDING_PAYMENT' AND hold_expires_at <= now();`,
        [id, passengerId]
      );

      // 3. Eligibility gate (application code, using the locked row above):
      //   status = 'SCHEDULED' AND now() < departure_time
      const now = new Date();
      const departureTime = new Date(departure.departure_time);
      if (departure.status !== "SCHEDULED" || now >= departureTime) {
        await queryRunner.rollbackTransaction();
        res.status(409).json({
          error: "Departure is not eligible for reservations",
        });
        return;
      }

      // 4. Live availability check — no counter column, no drift possible.
      const countResult = await queryRunner.query(
        `SELECT count(*)::int AS count FROM reservations
         WHERE departure_id = $1
           AND (status = 'CONFIRMED'
                OR (status = 'PENDING_PAYMENT' AND hold_expires_at > now()));`,
        [id]
      );

      const activeReservations = parseInt(countResult[0]?.count ?? "0", 10);
      if (activeReservations >= departure.capacity) {
        await queryRunner.rollbackTransaction();
        res.status(409).json({
          error: "No available capacity on this departure",
        });
        return;
      }

      // 5. If count < capacity, proceed to insert reservation:
      const insertResult = await queryRunner.query(
        `INSERT INTO reservations (departure_id, passenger_id, status, fare_amount, hold_expires_at)
         VALUES ($1, $2, 'PENDING_PAYMENT', $3, now() + ($4 * interval '1 minute'))
         RETURNING id, status, hold_expires_at, fare_amount;`,
        [id, passengerId, departure.fare_amount, holdMinutes]
      );

      await queryRunner.commitTransaction();

      const reservation = insertResult[0];
      res.status(201).json({
        reservationId: reservation.id,
        status: reservation.status,
        holdExpiresAt: reservation.hold_expires_at,
        fareAmount: reservation.fare_amount,
      });
    } catch (err: any) {
      await queryRunner.rollbackTransaction();

      // Postgres error code 23505: unique_violation from partial unique index
      // one_active_reservation_per_passenger_per_departure
      if (err.code === "23505") {
        res.status(409).json({
          error: "Passenger already has an active reservation for this departure",
        });
        return;
      }

      throw err;
    } finally {
      await queryRunner.release();
    }
  }
);

/**
 * @openapi
 * /departures/{id}/arrive:
 *   post:
 *     summary: Mark vehicle arrival at departure pickup point (DRIVER role only, departure owner).
 *     description: Driver marks vehicle arrival at pickup point. Departure status must be SCHEDULED. Sets status to ARRIVED and arrived_at timestamp. Driver can only have one active trip in progress or arrived.
 *     tags:
 *       - Departures
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Departure UUID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *           example: {}
 *     responses:
 *       200:
 *         description: Arrival marked successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 departureId:
 *                   type: string
 *                   format: uuid
 *                 status:
 *                   type: string
 *                 arrivedAt:
 *                   type: string
 *                   format: date-time
 *             example:
 *               departureId: "123e4567-e89b-12d3-a456-426614174000"
 *               status: "ARRIVED"
 *               arrivedAt: "2026-11-01T11:55:00.000Z"
 *       400:
 *         description: Invalid departure ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Invalid departure ID format"
 *       401:
 *         description: Authentication token missing or invalid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Authentication token missing or invalid"
 *       403:
 *         description: Forbidden (not a driver or not the departure owner)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Forbidden: you do not own this departure"
 *       404:
 *         description: Departure not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Departure not found"
 *       409:
 *         description: Invalid state transition or active trip already in progress
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Cannot arrive: departure status is ARRIVED, expected SCHEDULED"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Internal server error"
 */
router.post(
  "/:id/arrive",
  requireAuth,
  requireRole("DRIVER"),
  async (req: Request, res: Response): Promise<void> => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!z.string().uuid().safeParse(id).success) {
      res.status(400).json({ error: "Invalid departure ID format" });
      return;
    }

    const driverId = req.user!.id;
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const departures = await queryRunner.query(
        `SELECT id, driver_id, status, arrived_at
         FROM departures
         WHERE id = $1
         FOR UPDATE;`,
        [id]
      );

      if (departures.length === 0) {
        await queryRunner.rollbackTransaction();
        res.status(404).json({ error: "Departure not found" });
        return;
      }

      const departure = departures[0];

      if (departure.driver_id !== driverId) {
        await queryRunner.rollbackTransaction();
        res.status(403).json({ error: "Forbidden: you do not own this departure" });
        return;
      }

      if (departure.status !== "SCHEDULED") {
        await queryRunner.rollbackTransaction();
        res.status(409).json({
          error: `Cannot arrive: departure status is ${departure.status}, expected SCHEDULED`,
        });
        return;
      }

      const updateResult = await queryRunner.query(
        `UPDATE departures
         SET status = 'ARRIVED', arrived_at = now()
         WHERE id = $1
         RETURNING id, status, arrived_at;`,
        [id]
      );

      await queryRunner.commitTransaction();

      const row = Array.isArray(updateResult) && Array.isArray(updateResult[0])
        ? updateResult[0][0]
        : (Array.isArray(updateResult) ? updateResult[0] : updateResult);

      res.status(200).json({
        departureId: row?.id || id,
        status: row?.status || "ARRIVED",
        arrivedAt: row?.arrived_at,
      });
    } catch (err: any) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }

      if (err.code === "23505") {
        res.status(409).json({ error: "You already have a trip in progress" });
        return;
      }

      throw err;
    } finally {
      await queryRunner.release();
    }
  }
);

/**
 * @openapi
 * /departures/{id}/depart:
 *   post:
 *     summary: Mark departure trip underway (DRIVER role only, departure owner).
 *     description: Driver marks departure underway (trip start). Departure status must be ARRIVED. Sets status to IN_PROGRESS and departed_at timestamp.
 *     tags:
 *       - Departures
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Departure UUID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *           example: {}
 *     responses:
 *       200:
 *         description: Trip marked in progress successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 departureId:
 *                   type: string
 *                   format: uuid
 *                 status:
 *                   type: string
 *                 departedAt:
 *                   type: string
 *                   format: date-time
 *             example:
 *               departureId: "123e4567-e89b-12d3-a456-426614174000"
 *               status: "IN_PROGRESS"
 *               departedAt: "2026-11-01T12:00:00.000Z"
 *       400:
 *         description: Invalid departure ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Invalid departure ID format"
 *       401:
 *         description: Authentication token missing or invalid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Authentication token missing or invalid"
 *       403:
 *         description: Forbidden (not a driver or not the departure owner)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Forbidden: you do not own this departure"
 *       404:
 *         description: Departure not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Departure not found"
 *       409:
 *         description: Invalid state transition
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Cannot depart: departure status is SCHEDULED, expected ARRIVED"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Internal server error"
 */
router.post(
  "/:id/depart",
  requireAuth,
  requireRole("DRIVER"),
  async (req: Request, res: Response): Promise<void> => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!z.string().uuid().safeParse(id).success) {
      res.status(400).json({ error: "Invalid departure ID format" });
      return;
    }

    const driverId = req.user!.id;
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const departures = await queryRunner.query(
        `SELECT id, driver_id, status, departed_at
         FROM departures
         WHERE id = $1
         FOR UPDATE;`,
        [id]
      );

      if (departures.length === 0) {
        await queryRunner.rollbackTransaction();
        res.status(404).json({ error: "Departure not found" });
        return;
      }

      const departure = departures[0];

      if (departure.driver_id !== driverId) {
        await queryRunner.rollbackTransaction();
        res.status(403).json({ error: "Forbidden: you do not own this departure" });
        return;
      }

      if (departure.status !== "ARRIVED") {
        await queryRunner.rollbackTransaction();
        res.status(409).json({
          error: `Cannot depart: departure status is ${departure.status}, expected ARRIVED`,
        });
        return;
      }

      const updateResult = await queryRunner.query(
        `UPDATE departures
         SET status = 'IN_PROGRESS', departed_at = now()
         WHERE id = $1
         RETURNING id, status, departed_at;`,
        [id]
      );

      await queryRunner.commitTransaction();

      const row = Array.isArray(updateResult) && Array.isArray(updateResult[0])
        ? updateResult[0][0]
        : (Array.isArray(updateResult) ? updateResult[0] : updateResult);

      res.status(200).json({
        departureId: row?.id || id,
        status: row?.status || "IN_PROGRESS",
        departedAt: row?.departed_at,
      });
    } catch (err: any) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }

      if (err.code === "23505") {
        res.status(409).json({ error: "You already have a trip in progress" });
        return;
      }

      throw err;
    } finally {
      await queryRunner.release();
    }
  }
);

/**
 * @openapi
 * /departures/{id}/complete:
 *   post:
 *     summary: Mark departure trip as completed (DRIVER role only, departure owner).
 *     description: Driver marks departure completed. Departure status must be IN_PROGRESS. Sets status to COMPLETED, completed_at timestamp, and moves all CONFIRMED reservations on this departure to COMPLETED in the same transaction.
 *     tags:
 *       - Departures
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Departure UUID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *           example: {}
 *     responses:
 *       200:
 *         description: Trip marked completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 departureId:
 *                   type: string
 *                   format: uuid
 *                 status:
 *                   type: string
 *                 completedAt:
 *                   type: string
 *                   format: date-time
 *             example:
 *               departureId: "123e4567-e89b-12d3-a456-426614174000"
 *               status: "COMPLETED"
 *               completedAt: "2026-11-01T12:45:00.000Z"
 *       400:
 *         description: Invalid departure ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Invalid departure ID format"
 *       401:
 *         description: Authentication token missing or invalid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Authentication token missing or invalid"
 *       403:
 *         description: Forbidden (not a driver or not the departure owner)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Forbidden: you do not own this departure"
 *       404:
 *         description: Departure not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Departure not found"
 *       409:
 *         description: Invalid state transition
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Cannot complete: departure status is ARRIVED, expected IN_PROGRESS"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Internal server error"
 */
router.post(
  "/:id/complete",
  requireAuth,
  requireRole("DRIVER"),
  async (req: Request, res: Response): Promise<void> => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!z.string().uuid().safeParse(id).success) {
      res.status(400).json({ error: "Invalid departure ID format" });
      return;
    }

    const driverId = req.user!.id;
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const departures = await queryRunner.query(
        `SELECT id, driver_id, status, completed_at
         FROM departures
         WHERE id = $1
         FOR UPDATE;`,
        [id]
      );

      if (departures.length === 0) {
        await queryRunner.rollbackTransaction();
        res.status(404).json({ error: "Departure not found" });
        return;
      }

      const departure = departures[0];

      if (departure.driver_id !== driverId) {
        await queryRunner.rollbackTransaction();
        res.status(403).json({ error: "Forbidden: you do not own this departure" });
        return;
      }

      if (departure.status !== "IN_PROGRESS") {
        await queryRunner.rollbackTransaction();
        res.status(409).json({
          error: `Cannot complete: departure status is ${departure.status}, expected IN_PROGRESS`,
        });
        return;
      }

      const updateResult = await queryRunner.query(
        `UPDATE departures
         SET status = 'COMPLETED', completed_at = now()
         WHERE id = $1
         RETURNING id, status, completed_at;`,
        [id]
      );

      await queryRunner.query(
        `UPDATE reservations
         SET status = 'COMPLETED'
         WHERE departure_id = $1 AND status = 'CONFIRMED';`,
        [id]
      );

      await queryRunner.commitTransaction();

      const row = Array.isArray(updateResult) && Array.isArray(updateResult[0])
        ? updateResult[0][0]
        : (Array.isArray(updateResult) ? updateResult[0] : updateResult);

      res.status(200).json({
        departureId: row?.id || id,
        status: row?.status || "COMPLETED",
        completedAt: row?.completed_at,
      });
    } catch (err) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
);

/**
 * @openapi
 * /departures/{id}/cancel:
 *   post:
 *     summary: Cancel a scheduled or arrived departure (DRIVER role only, departure owner).
 *     description: Driver cancels a scheduled or arrived departure. Cancels all active reservations with cancellation_reason DEPARTURE_CANCELLED, marks SUCCEEDED payments as REFUNDED, marks PENDING payments as EXPIRED, generates passenger notifications, and frees the driver and vehicle time slots.
 *     tags:
 *       - Departures
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Departure UUID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *           example: {}
 *     responses:
 *       200:
 *         description: Departure cancelled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 departureId:
 *                   type: string
 *                   format: uuid
 *                 status:
 *                   type: string
 *                 cancelledReservations:
 *                   type: integer
 *                 refunds:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       reservationId:
 *                         type: string
 *                         format: uuid
 *                       amount:
 *                         type: string
 *             example:
 *               departureId: "123e4567-e89b-12d3-a456-426614174000"
 *               status: "CANCELLED"
 *               cancelledReservations: 3
 *               refunds:
 *                 - reservationId: "123e4567-e89b-12d3-a456-426614174001"
 *                   amount: "3000.00"
 *       400:
 *         description: Invalid departure ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Invalid departure ID format"
 *       401:
 *         description: Authentication token missing or invalid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Authentication token missing or invalid"
 *       403:
 *         description: Forbidden (not driver or not departure owner)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Forbidden: you do not own this departure"
 *       404:
 *         description: Departure not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Departure not found"
 *       409:
 *         description: Invalid state transition
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Cannot cancel departure: status is IN_PROGRESS, expected SCHEDULED or ARRIVED"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Internal server error"
 */
router.post(
  "/:id/cancel",
  requireAuth,
  requireRole("DRIVER"),
  async (req: Request, res: Response): Promise<void> => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!z.string().uuid().safeParse(id).success) {
      res.status(400).json({ error: "Invalid departure ID format" });
      return;
    }

    const driverId = req.user!.id;
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. SELECT the departure FOR UPDATE
      const departures = await queryRunner.query(
        `SELECT id, driver_id, route_id, departure_time, status
         FROM departures
         WHERE id = $1
         FOR UPDATE;`,
        [id]
      );

      if (departures.length === 0) {
        await queryRunner.rollbackTransaction();
        res.status(404).json({ error: "Departure not found" });
        return;
      }

      const departure = departures[0];

      if (departure.driver_id !== driverId) {
        await queryRunner.rollbackTransaction();
        res.status(403).json({ error: "Forbidden: you do not own this departure" });
        return;
      }

      // Verify its status is SCHEDULED or ARRIVED, else 409
      if (departure.status !== "SCHEDULED" && departure.status !== "ARRIVED") {
        await queryRunner.rollbackTransaction();
        res.status(409).json({
          error: `Cannot cancel departure: status is ${departure.status}, expected SCHEDULED or ARRIVED`,
        });
        return;
      }

      // 2. Lock all payments and reservations of this departure (FOR UPDATE, ordered by id so concurrent cancellations can't deadlock).
      // Lock payments first (per lock-ordering rule: departure, then payment, then reservation):
      const lockedPayments = await queryRunner.query(
        `SELECT p.id, p.reservation_id, p.amount, p.status
         FROM payments p
         WHERE p.reservation_id IN (
           SELECT r.id FROM reservations r WHERE r.departure_id = $1
         )
         ORDER BY p.id
         FOR UPDATE;`,
        [id]
      );

      // Lock reservations of this departure:
      const lockedReservations = await queryRunner.query(
        `SELECT r.id, r.departure_id, r.passenger_id, r.status, r.fare_amount
         FROM reservations r
         WHERE r.departure_id = $1
         ORDER BY r.id
         FOR UPDATE;`,
        [id]
      );

      // Read route info for notification payload
      const routes = await queryRunner.query(
        `SELECT pickup_point, dropoff_point FROM routes WHERE id = $1;`,
        [departure.route_id]
      );
      const route = routes[0] || { pickup_point: "", dropoff_point: "" };

      // 3. Read every status acted on from the locked rows:
      // Departure: status = 'CANCELLED', cancelled_at = now(), cancellation_reason = 'DRIVER_CANCELLED'
      await queryRunner.query(
        `UPDATE departures
         SET status = 'CANCELLED', cancelled_at = now(), cancellation_reason = 'DRIVER_CANCELLED'
         WHERE id = $1;`,
        [id]
      );

      // Affected reservations in PENDING_PAYMENT or CONFIRMED:
      const affectedReservations = lockedReservations.filter(
        (r: any) => r.status === "PENDING_PAYMENT" || r.status === "CONFIRMED"
      );

      const refunds: Array<{ reservationId: string; amount: string }> = [];

      if (affectedReservations.length > 0) {
        // Every reservation in PENDING_PAYMENT or CONFIRMED: status = 'CANCELLED', cancelled_at = now(), cancellation_reason = 'DEPARTURE_CANCELLED'
        await queryRunner.query(
          `UPDATE reservations
           SET status = 'CANCELLED', cancelled_at = now(), cancellation_reason = 'DEPARTURE_CANCELLED'
           WHERE departure_id = $1 AND status IN ('PENDING_PAYMENT', 'CONFIRMED');`,
          [id]
        );

        // Every SUCCEEDED payment of those reservations: status = 'REFUNDED', refunded_at = now()
        const refundUpdateResult = await queryRunner.query(
          `UPDATE payments
           SET status = 'REFUNDED', refunded_at = now()
           WHERE reservation_id IN (
             SELECT id FROM reservations
             WHERE departure_id = $1 AND cancellation_reason = 'DEPARTURE_CANCELLED'
           ) AND status = 'SUCCEEDED'
           RETURNING id, reservation_id, amount;`,
          [id]
        );

        const refundRows =
          Array.isArray(refundUpdateResult) && Array.isArray(refundUpdateResult[0])
            ? refundUpdateResult[0]
            : (Array.isArray(refundUpdateResult) ? refundUpdateResult : []);

        const refundMap = new Map<string, string>();
        for (const row of refundRows) {
          refundMap.set(row.reservation_id, row.amount);
          refunds.push({ reservationId: row.reservation_id, amount: row.amount });
        }

        // Every PENDING payment: status = 'EXPIRED', completed_at = now()
        await queryRunner.query(
          `UPDATE payments
           SET status = 'EXPIRED', completed_at = now()
           WHERE reservation_id IN (
             SELECT id FROM reservations
             WHERE departure_id = $1 AND cancellation_reason = 'DEPARTURE_CANCELLED'
           ) AND status = 'PENDING';`,
          [id]
        );

        // One notification row per affected reservation, in the same transaction
        for (const r of affectedReservations) {
          const refundAmount = refundMap.get(r.id);
          const refundPayload = refundAmount
            ? { simulated: true, amount: refundAmount }
            : null;

          const payload = {
            departureId: departure.id,
            reservationId: r.id,
            departureTime:
              departure.departure_time instanceof Date
                ? departure.departure_time.toISOString()
                : new Date(departure.departure_time).toISOString(),
            pickupPoint: route.pickup_point,
            dropoffPoint: route.dropoff_point,
            refund: refundPayload,
          };

          await queryRunner.query(
            `INSERT INTO notifications (user_id, type, payload)
             VALUES ($1, $2, $3);`,
            [r.passenger_id, "DEPARTURE_CANCELLED", JSON.stringify(payload)]
          );
        }
      }

      await queryRunner.commitTransaction();

      res.status(200).json({
        departureId: id,
        status: "CANCELLED",
        cancelledReservations: affectedReservations.length,
        refunds,
      });
    } catch (err) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
);

export default router;

