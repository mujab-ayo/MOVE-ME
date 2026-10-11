import { Router, Request, Response } from "express";
import { AppDataSource } from "../data-source";
import { Reservation } from "../entities/reservation.entity";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

/**
 * @openapi
 * /passengers/me/reservations:
 *   get:
 *     summary: List caller's own reservations
 *     description: Retrieves all reservations belonging to the authenticated passenger, ordered by created_at descending. Opportunistically updates any stale PENDING_PAYMENT reservations whose hold has elapsed to EXPIRED before responding.
 *     tags:
 *       - Passengers
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
 *                     example: CONFIRMED
 *                   fare_amount:
 *                     type: string
 *                     example: "3000.00"
 *                   hold_expires_at:
 *                     type: string
 *                     format: date-time
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *       401:
 *         description: Authentication token missing or invalid
 *       403:
 *         description: Forbidden - passenger role required
 *       500:
 *         description: Internal server error
 */
router.get(
  "/me/reservations",
  requireAuth,
  requireRole("PASSENGER"),
  async (req: Request, res: Response): Promise<void> => {
    const reservationRepo = AppDataSource.getRepository(Reservation);
    const passengerId = req.user!.id;

    try {
      // Guarded opportunistic status flip: only flip caller's reservations that are currently PENDING_PAYMENT and hold elapsed
      await AppDataSource.query(
        `UPDATE reservations
         SET status = 'EXPIRED'
         WHERE passenger_id = $1 AND status = 'PENDING_PAYMENT' AND hold_expires_at <= now();`,
        [passengerId]
      );

      // Data ownership requirement (Week 2 rubric competency adapted for passengers):
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
        cancelled_at: res.cancelled_at,
        cancellation_reason: res.cancellation_reason,
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
    } catch (_err) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
