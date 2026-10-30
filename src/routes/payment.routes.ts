import { Router, Request, Response } from "express";
import { z } from "zod";
import { AppDataSource } from "../data-source";
import { Payment } from "../entities/payment.entity";
import { requireAuth } from "../middleware/auth.middleware";
import { applyPaymentOutcome } from "../services/payment-outcome.service";
import { simulatedAllowed } from "../services/payment-mode";

const router = Router();

const callbackSchema = z.object({
  outcome: z.enum(["SUCCESS", "FAILURE"]),
  idempotencyKey: z.string().optional(),
});

/**
 * @openapi
 * /payments/{id}/callback:
 *   post:
 *     summary: Process payment provider outcome callback (simulated payments only; not available in production).
 *     description: Internal simulated PSP webhook callback to settle payments. Simulated payments only; not available in production (disabled unless ALLOW_SIMULATED_PAYMENTS is true outside production). Performs critical MM-06 validity checks.
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
 *           example:
 *             outcome: "SUCCESS"
 *     responses:
 *       200:
 *         description: Callback processed (SUCCEEDED/FAILED) or safely ignored as no-op (IGNORED for late or duplicate callbacks)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum:
 *                     - SUCCEEDED
 *                     - FAILED
 *                     - IGNORED
 *                 reservationStatus:
 *                   type: string
 *                 message:
 *                   type: string
 *                 paymentStatus:
 *                   type: string
 *             examples:
 *               succeeded:
 *                 summary: Payment succeeded and reservation confirmed
 *                 value:
 *                   status: "SUCCEEDED"
 *                   reservationStatus: "CONFIRMED"
 *               ignored:
 *                 summary: Late or duplicate callback safely ignored
 *                 value:
 *                   status: "IGNORED"
 *                   message: "Late callback on expired reservation - payment marked EXPIRED"
 *                   paymentStatus: "EXPIRED"
 *       400:
 *         description: Invalid payment ID format or payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Invalid callback payload: outcome must be 'SUCCESS' or 'FAILURE'"
 *       403:
 *         description: Forbidden - simulated callback on a Paystack payment
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "This payment is confirmed by the payment provider only"
 *       404:
 *         description: Payment not found, or simulated payments disabled
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               notFound:
 *                 value:
 *                   error: "Payment not found"
 *               disabled:
 *                 value:
 *                   error: "Not found"
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
  "/:id/callback",
  async (req: Request, res: Response): Promise<void> => {
    if (!simulatedAllowed()) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!z.string().uuid().safeParse(id).success) {
      res.status(400).json({ error: "Invalid payment ID format" });
      return;
    }

    const parseResult = callbackSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: "Invalid callback payload: outcome must be 'SUCCESS' or 'FAILURE'",
      });
      return;
    }

    const { outcome } = parseResult.data;

    const paymentRepo = AppDataSource.getRepository(Payment);
    const existingPayment = await paymentRepo.findOne({ where: { id } });
    if (!existingPayment) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }

    if (existingPayment.provider === "PAYSTACK") {
      res.status(403).json({
        error: "This payment is confirmed by the payment provider only",
      });
      return;
    }

    const result = await applyPaymentOutcome(id, outcome);

    if ("error" in result) {
      res.status(404).json(result);
      return;
    }

    res.status(200).json(result);
  }
);

/**
 * @openapi
 * /payments/return:
 *   get:
 *     summary: Public payment provider return landing page.
 *     description: Public HTML landing page displayed to the user after returning from payment provider checkout. Informs the user that payment was submitted and the booking is confirmed when the payment provider notifies the server.
 *     tags:
 *       - Payments
 *     responses:
 *       200:
 *         description: HTML return page
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *             example: "<!DOCTYPE html><html lang=\"en\"><head><title>Payment Submitted - MoveMe</title></head><body>...</body></html>"
 */
router.get(
  "/return",
  (_req: Request, res: Response): void => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Submitted - MoveMe</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0f172a; color: #f8fafc; }
    .card { background: #1e293b; padding: 2rem; border-radius: 0.75rem; max-width: 480px; text-align: center; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
    h1 { margin-top: 0; color: #38bdf8; font-size: 1.5rem; }
    p { color: #cbd5e1; line-height: 1.5; margin: 1rem 0 1.5rem; }
    a { display: inline-block; background: #2563eb; color: #fff; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-weight: 500; }
    a:hover { background: #1d4ed8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Payment Submitted</h1>
    <p>Your payment was submitted and the booking is confirmed when the payment provider notifies the server.</p>
    <a href="/app/">Back to /app/</a>
  </div>
</body>
</html>`);
  }
);

/**
 * @openapi
 * /payments/{id}:
 *   get:
 *     summary: Retrieve payment status and details (PASSENGER role only, reservation owner).
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   format: uuid
 *                 reservation_id:
 *                   type: string
 *                   format: uuid
 *                 amount:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum:
 *                     - PENDING
 *                     - SUCCEEDED
 *                     - FAILED
 *                     - EXPIRED
 *                     - REFUND_PENDING
 *                     - REFUNDED
 *                     - REFUND_FAILED
 *                   description: "Payment status (including refund lifecycle statuses: REFUND_PENDING, REFUNDED, REFUND_FAILED)"
 *                 completed_at:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                 refunded_at:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *             example:
 *               id: "123e4567-e89b-12d3-a456-426614174000"
 *               reservation_id: "123e4567-e89b-12d3-a456-426614174001"
 *               amount: "3000.00"
 *               status: "SUCCEEDED"
 *               completed_at: "2026-10-25T10:05:00.000Z"
 *               refunded_at: null
 *       400:
 *         description: Invalid payment ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Invalid payment ID format"
 *       401:
 *         description: Authentication token missing or invalid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Authentication token missing or invalid"
 *       403:
 *         description: Forbidden - not your payment
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Forbidden: not your payment"
 *       404:
 *         description: Payment not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Payment not found"
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
  "/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    if (!z.string().uuid().safeParse(id).success) {
      res.status(400).json({ error: "Invalid payment ID format" });
      return;
    }

    const paymentRepo = AppDataSource.getRepository(Payment);
    const payment = await paymentRepo.findOne({
      where: { id },
      relations: { reservation: true },
    });

    if (!payment) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }

    const user = req.user!;
    const isOwner = user.role === "PASSENGER" && payment.reservation?.passenger_id === user.id;

    if (!isOwner) {
      res.status(403).json({ error: "Forbidden: not your payment" });
      return;
    }

    res.status(200).json({
      id: payment.id,
      reservation_id: payment.reservation_id,
      amount: payment.amount,
      status: payment.status,
      completed_at: payment.completed_at,
      refunded_at: payment.refunded_at,
    });
  }
);

export default router;
