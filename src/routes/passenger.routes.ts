import { Router, Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { Reservation } from "../entities/reservation.entity";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

/**
 * @openapi
 * /passengers/me/reservations:
 *   get:
 *     summary: List all reservations belonging to the authenticated passenger (PASSENGER role only).
 *     description: Retrieves all reservations belonging to the authenticated passenger, ordered by created_at descending. Opportunistically updates any stale PENDING_PAYMENT reservations whose hold has elapsed to EXPIRED before responding. Includes trip_status and departure timestamps.
 *     tags:
 *       - Bookings
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of reservations owned by the caller
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
 *                   departure_id:
 *                     type: string
 *                     format: uuid
 *                   passenger_id:
 *                     type: string
 *                     format: uuid
 *                   status:
 *                     type: string
 *                   trip_status:
 *                     type: string
 *                   fare_amount:
 *                     type: string
 *                   hold_expires_at:
 *                     type: string
 *                     format: date-time
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *                   arrived_at:
 *                     type: string
 *                     format: date-time
 *                     nullable: true
 *                   departed_at:
 *                     type: string
 *                     format: date-time
 *                     nullable: true
 *                   completed_at:
 *                     type: string
 *                     format: date-time
 *                     nullable: true
 *                   cancelled_at:
 *                     type: string
 *                     format: date-time
 *                     nullable: true
 *                   cancellation_reason:
 *                     type: string
 *                     nullable: true
 *             example:
 *               - id: "123e4567-e89b-12d3-a456-426614174000"
 *                 departure_id: "123e4567-e89b-12d3-a456-426614174001"
 *                 passenger_id: "123e4567-e89b-12d3-a456-426614174002"
 *                 status: "CONFIRMED"
 *                 trip_status: "SCHEDULED"
 *                 fare_amount: "3000.00"
 *                 hold_expires_at: "2026-10-25T10:15:00.000Z"
 *                 created_at: "2026-10-25T10:00:00.000Z"
 *                 arrived_at: null
 *                 departed_at: null
 *                 completed_at: null
 *                 cancelled_at: null
 *                 cancellation_reason: null
 *       401:
 *         description: Authentication token missing or invalid
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
router.get(
  "/me/reservations",
  requireAuth,
  requireRole("PASSENGER"),
  async (req: Request, res: Response): Promise<void> => {
    const reservationRepo = AppDataSource.getRepository(Reservation);
    const passengerId = req.user!.id;

    // Guarded opportunistic status flip: only flip caller's reservations that are currently PENDING_PAYMENT and hold elapsed
    await AppDataSource.query(
      `UPDATE reservations
       SET status = 'EXPIRED'
       WHERE passenger_id = $1 AND status = 'PENDING_PAYMENT' AND hold_expires_at <= now();`,
      [passengerId]
    );

    // Data ownership requirement:
    // Filtering by passenger_id = req.user.id is a strict authorization/data-ownership boundary,
    // NOT an optional search filter. Passengers must only ever see their own reservations.
    const reservations = await reservationRepo.find({
      where: { passenger_id: passengerId },
      order: { created_at: "DESC" },
      relations: { departure: { route: true } },
    });

    const response = reservations.map((res) => ({
      id: res.id,
      departure_id: res.departure_id,
      passenger_id: res.passenger_id,
      status: res.status,
      fare_amount: res.fare_amount,
      hold_expires_at: res.hold_expires_at,
      created_at: res.created_at,
      cancelled_at: res.cancelled_at ?? res.departure?.cancelled_at ?? null,
      cancellation_reason: res.cancellation_reason ?? res.departure?.cancellation_reason ?? null,
      // Trip progress and timestamps
      trip_status: res.departure?.status ?? null,
      tripStatus: res.departure?.status ?? null,
      arrived_at: res.departure?.arrived_at ?? null,
      arrivedAt: res.departure?.arrived_at ?? null,
      departed_at: res.departure?.departed_at ?? null,
      departedAt: res.departure?.departed_at ?? null,
      completed_at: res.departure?.completed_at ?? null,
      completedAt: res.departure?.completed_at ?? null,
      // Departure fields
      departure_time: res.departure?.departure_time,
      duration_minutes: res.departure?.duration_minutes,
      mode: res.departure?.mode,
      // Route fields
      pickup_point: res.departure?.route?.pickup_point,
      dropoff_point: res.departure?.route?.dropoff_point,
      // Nested departure entity
      departure: res.departure,
    }));

    res.status(200).json(response);
  }
);

/**
 * @openapi
 * /passengers/me/notifications:
 *   get:
 *     summary: List all notifications for the authenticated passenger (PASSENGER role only).
 *     description: Retrieves all notifications belonging to the authenticated passenger, ordered newest first (created_at DESC). Supports ?unread=true query filter.
 *     tags:
 *       - Bookings
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unread
 *         required: false
 *         schema:
 *           type: boolean
 *         description: If true, only return unread notifications (where read_at is null)
 *     responses:
 *       200:
 *         description: List of notifications
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
 *                   user_id:
 *                     type: string
 *                     format: uuid
 *                   type:
 *                     type: string
 *                   payload:
 *                     type: object
 *                   read_at:
 *                     type: string
 *                     format: date-time
 *                     nullable: true
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *             example:
 *               - id: "123e4567-e89b-12d3-a456-426614174000"
 *                 user_id: "123e4567-e89b-12d3-a456-426614174002"
 *                 type: "RESERVATION_CONFIRMED"
 *                 payload:
 *                   reservationId: "123e4567-e89b-12d3-a456-426614174000"
 *                   departureId: "123e4567-e89b-12d3-a456-426614174001"
 *                 read_at: null
 *                 created_at: "2026-10-25T10:05:00.000Z"
 *       401:
 *         description: Authentication token missing or invalid
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
router.get(
  "/me/notifications",
  requireAuth,
  requireRole("PASSENGER"),
  async (req: Request, res: Response): Promise<void> => {
    const passengerId = req.user!.id;
    const unreadOnly = req.query.unread === "true";

    const rows = unreadOnly
      ? await AppDataSource.query(
          `SELECT id, user_id, type, payload, read_at, created_at
           FROM notifications
           WHERE user_id = $1 AND read_at IS NULL
           ORDER BY created_at DESC;`,
          [passengerId]
        )
      : await AppDataSource.query(
          `SELECT id, user_id, type, payload, read_at, created_at
           FROM notifications
           WHERE user_id = $1
           ORDER BY created_at DESC;`,
          [passengerId]
        );

    const notifications = rows.map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      userId: row.user_id,
      type: row.type,
      payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
      read_at: row.read_at,
      readAt: row.read_at,
      created_at: row.created_at,
      createdAt: row.created_at,
    }));

    res.status(200).json(notifications);
  }
);

export default router;
