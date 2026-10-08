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
 *       - Reservations
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
        if (reservation.status === "PENDING_PAYMENT" && holdExpired) {
          await reservationRepo.update({ id }, { status: "EXPIRED" });
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
 *     description: Retrieves details of a reservation. Opportunistically marks it EXPIRED if hold elapsed.
 *     tags:
 *       - Reservations
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
 *         description: Authentication required
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Reservation not found
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
      const reservation = await reservationRepo.findOne({
        where: { id },
        relations: { departure: true, payments: true },
      });

      if (!reservation) {
        res.status(404).json({ error: "Reservation not found" });
        return;
      }

      const user = req.user!;
      if (user.role === "PASSENGER" && reservation.passenger_id !== user.id) {
        res.status(403).json({ error: "Forbidden: not your reservation" });
        return;
      }

      if (user.role === "DRIVER" && reservation.departure?.driver_id !== user.id) {
        res.status(403).json({ error: "Forbidden: not your departure" });
        return;
      }

      // Decision 6b: opportunistically flip status to EXPIRED if hold expired
      const now = new Date();
      if (
        reservation.status === "PENDING_PAYMENT" &&
        now >= new Date(reservation.hold_expires_at)
      ) {
        reservation.status = "EXPIRED";
        await reservationRepo.update({ id }, { status: "EXPIRED" });
      }

      res.status(200).json(reservation);
    } catch (_err) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
