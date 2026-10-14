import { Router, Request, Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { AppDataSource } from "../data-source";
import { Reservation } from "../entities/reservation.entity";
import { Payment } from "../entities/payment.entity";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

/**
 * @openapi
 * /reservations/{id}/payments:
 *   post:
 *     summary: Initiate simulated payment
 *     description: Creates a PENDING payment for a reservation if the hold is still valid.
 *     tags:
 *       - Payments
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Reservation ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               idempotencyKey:
 *                 type: string
 *     responses:
 *       201:
 *         description: Payment initiated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 paymentId:
 *                   type: string
 *                   format: uuid
 *                 status:
 *                   type: string
 *                   example: PENDING
 *       400:
 *         description: Invalid reservation ID format
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Forbidden - not your reservation or wrong role
 *       404:
 *         description: Reservation not found
 *       409:
 *         description: Reservation not pending payment or hold already expired
 *       500:
 *         description: Internal server error
 */
router.post(
  "/:id/payments",
  requireAuth,
  requireRole("PASSENGER"),
  async (req: Request, res: Response): Promise<void> => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!z.string().uuid().safeParse(id).success) {
      res.status(400).json({ error: "Invalid reservation ID format" });
      return;
    }

    const passengerId = req.user!.id;
    const reservationRepo = AppDataSource.getRepository(Reservation);
    const paymentRepo = AppDataSource.getRepository(Payment);

    try {
      // 1. Fetch reservation
      const reservation = await reservationRepo.findOne({
        where: { id },
      });

      if (!reservation) {
        res.status(404).json({ error: "Reservation not found" });
        return;
      }

      // 2. Data ownership: must be the reservation's own passenger
      if (reservation.passenger_id !== passengerId) {
        res.status(403).json({ error: "Forbidden: not your reservation" });
        return;
      }

      // 3. Expiry and status check:
      // Reject 409 if the reservation isn't PENDING_PAYMENT, or if hold_expires_at has already passed
      const now = new Date();
      const holdExpired = new Date(reservation.hold_expires_at) <= now;

      if (reservation.status !== "PENDING_PAYMENT" || holdExpired) {
        // Opportunistically materialize EXPIRED status if it was pending but time elapsed
        // Guarded write: never overwrite if confirmed by callback concurrently
        if (reservation.status === "PENDING_PAYMENT" && holdExpired) {
          await AppDataSource.query(
            `UPDATE reservations
             SET status = 'EXPIRED'
             WHERE id = $1 AND status = 'PENDING_PAYMENT' AND hold_expires_at <= now();`,
            [id]
          );
        }

        res.status(409).json({
          error: "Reservation is no longer pending payment or hold has expired",
        });
        return;
      }

      // 4. Create payment row: status PENDING, amount = reservation.fare_amount, generated idempotency_key
      const idempotencyKey =
        (typeof req.body?.idempotencyKey === "string" && req.body.idempotencyKey.trim().length > 0)
          ? req.body.idempotencyKey.trim()
          : crypto.randomUUID();

      const payment = paymentRepo.create({
        reservation_id: reservation.id,
        amount: reservation.fare_amount,
        status: "PENDING",
        idempotency_key: idempotencyKey,
      });

      await paymentRepo.save(payment);

      // 5. Return 201 {paymentId, status: 'PENDING'}
      res.status(201).json({
        paymentId: payment.id,
        status: payment.status,
      });
    } catch (err: any) {
      if (err.code === "23505" && err.constraint?.includes("idempotency")) {
        res.status(409).json({ error: "Payment with this idempotency key already exists" });
        return;
      }
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * @openapi
 * /reservations/{id}:
 *   get:
 *     summary: Get reservation details
 *     description: Retrieves details of a reservation. Accessible only by the passenger who owns it or the driver who owns the departure. Opportunistically updates any PENDING_PAYMENT reservation whose hold elapsed to EXPIRED before responding.
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
 *         description: Reservation ID
 *     responses:
 *       200:
 *         description: Reservation details
 *       400:
 *         description: Invalid reservation ID format
 *       401:
 *         description: Authentication required or invalid token
 *       403:
 *         description: Forbidden - not your reservation, not your departure, or insufficient permissions
 *       404:
 *         description: Reservation not found
 *       500:
 *         description: Internal server error
 */
router.get(
  "/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!z.string().uuid().safeParse(id).success) {
      res.status(400).json({ error: "Invalid reservation ID format" });
      return;
    }

    const reservationRepo = AppDataSource.getRepository(Reservation);

    try {
      let reservation = await reservationRepo.findOne({
        where: { id },
        relations: { departure: true, payments: true },
      });

      if (!reservation) {
        res.status(404).json({ error: "Reservation not found" });
        return;
      }

      // Ownership scoping pattern (Week 2 rubric competency adapted for reservations):
      // Allowed if and only if caller is the PASSENGER who owns the reservation OR the DRIVER who owns the departure.
      const user = req.user!;
      const isPassengerOwner = user.role === "PASSENGER" && reservation.passenger_id === user.id;
      const isDepartureDriver = user.role === "DRIVER" && reservation.departure?.driver_id === user.id;

      if (!isPassengerOwner && !isDepartureDriver) {
        if (user.role === "PASSENGER") {
          res.status(403).json({ error: "Forbidden: not your reservation" });
          return;
        }
        if (user.role === "DRIVER") {
          res.status(403).json({ error: "Forbidden: not your departure" });
          return;
        }
        res.status(403).json({ error: "Forbidden: insufficient permissions" });
        return;
      }

      // Decision 6b: opportunistically flip status to EXPIRED before responding if hold expired
      // Guarded write: only flip if status is still PENDING_PAYMENT and hold elapsed.
      // If 0 rows affected (e.g. callback confirmed concurrently), re-read from DB and return actual DB state.
      const now = new Date();
      if (
        reservation.status === "PENDING_PAYMENT" &&
        now >= new Date(reservation.hold_expires_at)
      ) {
        const updateResult = await AppDataSource.query(
          `UPDATE reservations
           SET status = 'EXPIRED'
           WHERE id = $1 AND status = 'PENDING_PAYMENT' AND hold_expires_at <= now()
           RETURNING id;`,
          [id]
        );

        if (updateResult.length > 0) {
          reservation.status = "EXPIRED";
        } else {
          const refreshed = await reservationRepo.findOne({
            where: { id },
            relations: { departure: true, payments: true },
          });
          if (refreshed) {
            reservation = refreshed;
          }
        }
      }

      res.status(200).json(reservation);
    } catch (_err) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * @openapi
 * /reservations/{id}/cancel:
 *   post:
 *     summary: Cancel a confirmed reservation
 *     description: Passenger cancels a confirmed reservation before departure time and before trip start. Triggers simulated refund.
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
 *         description: Reservation ID
 *     responses:
 *       200:
 *         description: Reservation cancelled successfully with simulated refund
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
 *                   example: CANCELLED
 *                 refund:
 *                   type: object
 *                   properties:
 *                     simulated:
 *                       type: boolean
 *                       example: true
 *                     paymentId:
 *                       type: string
 *                       format: uuid
 *                     amount:
 *                       type: string
 *                       example: "3000.00"
 *       400:
 *         description: Invalid reservation ID format
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Forbidden - not your reservation or not a passenger
 *       404:
 *         description: Reservation not found
 *       409:
 *         description: Conflict - reservation not confirmed, departure time passed, or trip already in progress
 *       500:
 *         description: Internal server error
 */
router.post(
  "/:id/cancel",
  requireAuth,
  requireRole("PASSENGER"),
  async (req: Request, res: Response): Promise<void> => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!z.string().uuid().safeParse(id).success) {
      res.status(400).json({ error: "Invalid reservation ID format" });
      return;
    }

    const passengerId = req.user!.id;
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      // 1. Read the reservation without a lock to find departure_id
      const reservationsPrelim = await queryRunner.query(
        `SELECT id, departure_id, passenger_id, status, fare_amount
         FROM reservations
         WHERE id = $1;`,
        [id]
      );

      if (reservationsPrelim.length === 0) {
        res.status(404).json({ error: "Reservation not found" });
        return;
      }

      const reservationPrelim = reservationsPrelim[0];

      if (reservationPrelim.passenger_id !== passengerId) {
        res.status(403).json({ error: "Forbidden: not your reservation" });
        return;
      }

      const departureId = reservationPrelim.departure_id;

      // 2. BEGIN
      await queryRunner.startTransaction();

      // 3. SELECT the departure FOR UPDATE
      const departures = await queryRunner.query(
        `SELECT id, status, departure_time
         FROM departures
         WHERE id = $1
         FOR UPDATE;`,
        [departureId]
      );

      if (departures.length === 0) {
        await queryRunner.rollbackTransaction();
        res.status(404).json({ error: "Associated departure not found" });
        return;
      }

      const departure = departures[0];

      // 4. Lock reservation's payment rows FOR UPDATE
      await queryRunner.query(
        `SELECT id, status, amount
         FROM payments
         WHERE reservation_id = $1
         FOR UPDATE;`,
        [id]
      );

      // 5. Lock the reservation FOR UPDATE and read current status under lock
      const lockedReservations = await queryRunner.query(
        `SELECT id, status
         FROM reservations
         WHERE id = $1
         FOR UPDATE;`,
        [id]
      );

      if (lockedReservations.length === 0) {
        await queryRunner.rollbackTransaction();
        res.status(404).json({ error: "Reservation not found" });
        return;
      }

      const lockedReservation = lockedReservations[0];

      // After all locks are held, evaluate clock_timestamp() so wait time doesn't make it stale
      const timeCheckResult = await queryRunner.query(
        `SELECT (departure_time > clock_timestamp()) AS is_before_departure_time
         FROM departures
         WHERE id = $1;`,
        [departureId]
      );
      const isBeforeDepartureTime = timeCheckResult[0]?.is_before_departure_time === true;

      // 6. Re-verify under the locks:
      // - The reservation must be CONFIRMED, else 409 ("Only a confirmed reservation can be cancelled")
      if (lockedReservation.status !== "CONFIRMED") {
        await queryRunner.rollbackTransaction();
        res.status(409).json({ error: "Only a confirmed reservation can be cancelled" });
        return;
      }

      // - The current time (clock_timestamp()) must be before the departure's departure_time,
      //   AND the departure status must be SCHEDULED or ARRIVED (the trip has not started), else 409.
      const isTripNotStarted =
        departure.status === "SCHEDULED" || departure.status === "ARRIVED";

      if (!isBeforeDepartureTime || !isTripNotStarted) {
        await queryRunner.rollbackTransaction();
        res.status(409).json({
          error: "Cannot cancel reservation: departure time has passed or trip is already in progress",
        });
        return;
      }

      // 7. Mutations in the same transaction:
      // - reservation: status = 'CANCELLED', cancelled_at = now(), cancellation_reason = 'PASSENGER_CANCELLED'
      const updateReservationResult = await queryRunner.query(
        `UPDATE reservations
         SET status = 'CANCELLED', cancelled_at = now(), cancellation_reason = 'PASSENGER_CANCELLED'
         WHERE id = $1 AND status = 'CONFIRMED'
         RETURNING id, status, cancelled_at, cancellation_reason;`,
        [id]
      );

      const reservationRows =
        Array.isArray(updateReservationResult) && Array.isArray(updateReservationResult[0])
          ? updateReservationResult[0]
          : (Array.isArray(updateReservationResult) ? updateReservationResult : []);

      if (reservationRows.length === 0) {
        await queryRunner.rollbackTransaction();
        res.status(409).json({ error: "Only a confirmed reservation can be cancelled" });
        return;
      }

      // - If the reservation has a SUCCEEDED payment:
      //   UPDATE payments SET status = 'REFUNDED', refunded_at = now() WHERE reservation_id = $1 AND status = 'SUCCEEDED' RETURNING id, amount. Exactly one refund.
      const updatePaymentResult = await queryRunner.query(
        `UPDATE payments
         SET status = 'REFUNDED', refunded_at = now()
         WHERE reservation_id = $1 AND status = 'SUCCEEDED'
         RETURNING id, amount;`,
        [id]
      );

      await queryRunner.commitTransaction();

      const refundRows =
        Array.isArray(updatePaymentResult) && Array.isArray(updatePaymentResult[0])
          ? updatePaymentResult[0]
          : (Array.isArray(updatePaymentResult) ? updatePaymentResult : []);
      const refundRow = refundRows[0];

      res.status(200).json({
        reservationId: id,
        status: "CANCELLED",
        refund: {
          simulated: true,
          paymentId: refundRow?.id ?? null,
          amount: refundRow?.amount ?? reservationPrelim.fare_amount,
        },
      });
    } catch (err: any) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      res.status(500).json({ error: "Internal server error" });
    } finally {
      await queryRunner.release();
    }
  }
);

export default router;
