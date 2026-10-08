import { Router, Request, Response } from "express";
import { z } from "zod";
import { AppDataSource } from "../data-source";
import { Payment } from "../entities/payment.entity";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

const callbackSchema = z.object({
  outcome: z.enum(["SUCCESS", "FAILURE"]),
  idempotencyKey: z.string().optional(),
});

/**
 * @openapi
 * /payments/{id}/callback:
 *   post:
 *     summary: Payment provider callback
 *     description: Internal simulated PSP webhook callback to settle payments. Performs critical MM-06 validity checks.
 *     tags:
 *       - Payments
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Payment ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - outcome
 *             properties:
 *               outcome:
 *                 type: string
 *                 enum: [SUCCESS, FAILURE]
 *               idempotencyKey:
 *                 type: string
 *     responses:
 *       200:
 *         description: Callback processed or safely ignored as no-op
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: SUCCEEDED
 *                 reservationStatus:
 *                   type: string
 *                   example: CONFIRMED
 *       400:
 *         description: Invalid payment ID format or payload
 *       404:
 *         description: Payment or associated reservation not found
 *       500:
 *         description: Internal server error
 */
router.post(
  "/:id/callback",
  async (req: Request, res: Response): Promise<void> => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!z.string().uuid().safeParse(id).success) {
      res.status(400).json({ error: "Invalid payment ID format" });
      return;
    }

    const parseResult = callbackSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: "Invalid callback payload: outcome must be 'SUCCESS' or 'FAILURE'",
        details: parseResult.error.flatten(),
      });
      return;
    }

    const { outcome } = parseResult.data;

    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      // 1. Read the payment (no lock) to get reservation_id, then the reservation's departure_id
      const paymentsPrelim = await queryRunner.query(
        `SELECT id, reservation_id, status
         FROM payments
         WHERE id = $1;`,
        [id]
      );

      if (paymentsPrelim.length === 0) {
        res.status(404).json({ error: "Payment not found" });
        return;
      }

      const paymentPrelim = paymentsPrelim[0];

      // If payment is already resolved (no longer PENDING), treat as no-op
      if (paymentPrelim.status !== "PENDING") {
        res.status(200).json({
          status: "IGNORED",
          message: `Payment already resolved with status ${paymentPrelim.status}`,
          paymentStatus: paymentPrelim.status,
        });
        return;
      }

      const reservationsPrelim = await queryRunner.query(
        `SELECT id, departure_id
         FROM reservations
         WHERE id = $1;`,
        [paymentPrelim.reservation_id]
      );

      if (reservationsPrelim.length === 0) {
        res.status(404).json({ error: "Associated reservation not found" });
        return;
      }

      const departureId = reservationsPrelim[0].departure_id;

      // 2. BEGIN, then SELECT the departure FOR UPDATE first (same lock, same order as the booking endpoint: departure before reservation)
      await queryRunner.startTransaction();

      const departures = await queryRunner.query(
        `SELECT id
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

      // 3. Lock payment FOR UPDATE, then reservation FOR UPDATE, and re-verify their statuses under the locks
      const payments = await queryRunner.query(
        `SELECT id, reservation_id, amount, status, idempotency_key
         FROM payments
         WHERE id = $1
         FOR UPDATE;`,
        [id]
      );

      if (payments.length === 0) {
        await queryRunner.rollbackTransaction();
        res.status(404).json({ error: "Payment not found" });
        return;
      }

      const payment = payments[0];

      // Re-verify payment status under the lock
      if (payment.status !== "PENDING") {
        await queryRunner.commitTransaction();
        res.status(200).json({
          status: "IGNORED",
          message: `Payment already resolved with status ${payment.status}`,
          paymentStatus: payment.status,
        });
        return;
      }

      // 4. Lock reservation FOR UPDATE and compute hold validity with clock_timestamp() instead of now()
      const reservations = await queryRunner.query(
        `SELECT id, departure_id, passenger_id, status, fare_amount, hold_expires_at,
                (hold_expires_at > clock_timestamp()) AS is_hold_valid
         FROM reservations
         WHERE id = $1
         FOR UPDATE;`,
        [payment.reservation_id]
      );

      if (reservations.length === 0) {
        await queryRunner.rollbackTransaction();
        res.status(404).json({ error: "Associated reservation not found" });
        return;
      }

      const reservation = reservations[0];

      // Re-verify reservation status and hold validity under the lock
      const isStillPending = reservation.status === "PENDING_PAYMENT";
      const isHoldValid = reservation.is_hold_valid === true;
      const isReservationStillValid = isStillPending && isHoldValid;

      if (!isReservationStillValid) {
        // Late callback on an expired or invalid reservation — treat it as a no-op (don't confirm, don't error loudly)
        // Update payment to EXPIRED if it's still PENDING
        await queryRunner.query(
          `UPDATE payments
           SET status = 'EXPIRED', completed_at = now()
           WHERE id = $1 AND status = 'PENDING';`,
          [id]
        );

        // Lazily materialize reservation status to EXPIRED if it was pending
        if (isStillPending) {
          await queryRunner.query(
            `UPDATE reservations
             SET status = 'EXPIRED'
             WHERE id = $1 AND status = 'PENDING_PAYMENT';`,
            [reservation.id]
          );
        }

        await queryRunner.commitTransaction();

        res.status(200).json({
          status: "IGNORED",
          message: "Late callback on expired reservation - payment marked EXPIRED",
          paymentStatus: "EXPIRED",
        });
        return;
      }

      // 4. Reservation is valid and unexpired:
      if (outcome === "SUCCESS") {
        try {
          // Update payment to SUCCEEDED
          await queryRunner.query(
            `UPDATE payments
             SET status = 'SUCCEEDED', completed_at = now()
             WHERE id = $1;`,
            [id]
          );

          // Update reservation to CONFIRMED
          await queryRunner.query(
            `UPDATE reservations
             SET status = 'CONFIRMED'
             WHERE id = $1;`,
            [reservation.id]
          );

          await queryRunner.commitTransaction();

          res.status(200).json({
            status: "SUCCEEDED",
            reservationStatus: "CONFIRMED",
          });
          return;
        } catch (innerErr: any) {
          // Rely on the one_successful_payment_per_reservation unique index as the backstop
          // against a duplicate success — catch that specific constraint violation and treat it as a no-op too
          if (
            innerErr.code === "23505" &&
            (innerErr.constraint?.includes("one_successful_payment") ||
              innerErr.detail?.includes("Key (reservation_id)"))
          ) {
            await queryRunner.rollbackTransaction();
            res.status(200).json({
              status: "IGNORED",
              message: "Duplicate successful payment for reservation - ignored",
            });
            return;
          }
          throw innerErr;
        }
      } else {
        // outcome === 'FAILURE': update payment to FAILED, reservation to FAILED
        await queryRunner.query(
          `UPDATE payments
           SET status = 'FAILED', completed_at = now()
           WHERE id = $1;`,
          [id]
        );

        await queryRunner.query(
          `UPDATE reservations
           SET status = 'FAILED'
           WHERE id = $1;`,
          [reservation.id]
        );

        await queryRunner.commitTransaction();

        res.status(200).json({
          status: "FAILED",
          reservationStatus: "FAILED",
        });
        return;
      }
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

/**
 * @openapi
 * /payments/{id}:
 *   get:
 *     summary: Get payment details
 *     description: Retrieves details of a payment.
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
 *         description: Payment ID
 *     responses:
 *       200:
 *         description: Payment details
 *       400:
 *         description: Invalid payment ID format
 *       401:
 *         description: Authentication required
 *       404:
 *         description: Payment not found
 */
router.get(
  "/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!z.string().uuid().safeParse(id).success) {
      res.status(400).json({ error: "Invalid payment ID format" });
      return;
    }

    const paymentRepo = AppDataSource.getRepository(Payment);
    try {
      const payment = await paymentRepo.findOne({
        where: { id },
        relations: { reservation: true },
      });

      if (!payment) {
        res.status(404).json({ error: "Payment not found" });
        return;
      }

      res.status(200).json(payment);
    } catch (_err) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
