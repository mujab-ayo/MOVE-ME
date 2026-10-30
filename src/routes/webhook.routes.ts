import { Router, Request, Response } from "express";
import crypto from "crypto";
import { AppDataSource } from "../data-source";
import { Payment } from "../entities/payment.entity";
import { getSecretKey, toKobo } from "../services/paystack.client";
import { applyPaymentOutcome } from "../services/payment-outcome.service";
import { requestRefund } from "../services/refund.service";

const router = Router();

/**
 * @openapi
 * /webhooks/paystack:
 *   post:
 *     summary: Paystack payment gateway webhook listener (Public).
 *     description: Webhook endpoint called by Paystack (not by clients) to report payment settlement and refund events. Authenticated by HMAC SHA512 signature in the x-paystack-signature header.
 *     tags:
 *       - Payments
 *     parameters:
 *       - in: header
 *         name: x-paystack-signature
 *         required: true
 *         schema:
 *           type: string
 *         description: HMAC SHA512 signature of request body computed with PAYSTACK_SECRET_KEY
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - event
 *               - data
 *             properties:
 *               event:
 *                 type: string
 *                 example: "charge.success"
 *               data:
 *                 type: object
 *                 properties:
 *                   status:
 *                     type: string
 *                     example: "success"
 *                   reference:
 *                     type: string
 *                     example: "mm_123e4567-e89b-12d3-a456-426614174000"
 *                   amount:
 *                     type: integer
 *                     description: Amount charged in kobo (NGN)
 *                     example: 300000
 *                   currency:
 *                     type: string
 *                     example: "NGN"
 *           examples:
 *             chargeSuccess:
 *               summary: Example charge.success event
 *               value:
 *                 event: "charge.success"
 *                 data:
 *                   status: "success"
 *                   reference: "mm_123e4567-e89b-12d3-a456-426614174000"
 *                   amount: 300000
 *                   currency: "NGN"
 *     responses:
 *       200:
 *         description: Event received and processed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 received:
 *                   type: boolean
 *                   example: true
 *             example:
 *               received: true
 *       401:
 *         description: Invalid signature
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Invalid signature"
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
  "/paystack",
  async (req: Request, res: Response): Promise<void> => {
    const signature = req.headers["x-paystack-signature"];
    if (!signature || typeof signature !== "string") {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    let secretKey: string;
    try {
      secretKey = getSecretKey();
    } catch {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const hash = crypto.createHmac("sha512", secretKey).update(rawBody).digest("hex");

    const hashBuf = Buffer.from(hash, "utf8");
    const sigBuf = Buffer.from(signature, "utf8");

    if (hashBuf.length !== sigBuf.length || !crypto.timingSafeEqual(hashBuf, sigBuf)) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    try {
      const event = req.body?.event;
      const data = req.body?.data;
      const paymentRepo = AppDataSource.getRepository(Payment);

      if (event === "charge.success") {
        const reference = data?.reference;

        if (!reference) {
          res.status(200).json({ received: true });
          return;
        }

        const payment = await paymentRepo.findOne({
          where: {
            provider_reference: reference,
            provider: "PAYSTACK",
          },
        });

        if (!payment) {
          console.log(`Payment not found for reference: ${reference}`);
          res.status(200).json({ received: true });
          return;
        }

        if (
          data?.status !== "success" ||
          data?.currency !== "NGN" ||
          data?.amount !== toKobo(payment.amount)
        ) {
          console.warn(
            `Warning: Paystack charge.success mismatch for reference: ${reference}`
          );
          res.status(200).json({ received: true });
          return;
        }

        const outcomeResult = await applyPaymentOutcome(payment.id, "SUCCESS");
        res.status(200).json({ received: true });

        if (outcomeResult.refundDue) {
          requestRefund(outcomeResult.refundDue).catch((err) => {
            console.error(
              `Error requesting refund for payment ${outcomeResult.refundDue}:`,
              err
            );
          });
        }
        return;
      }

      if (event === "refund.processed") {
        const transactionReference =
          data?.transaction_reference || data?.transaction?.reference;

        if (!transactionReference) {
          res.status(200).json({ received: true });
          return;
        }

        const payment = await paymentRepo.findOne({
          where: {
            provider_reference: transactionReference,
            provider: "PAYSTACK",
          },
        });

        if (!payment) {
          console.log(`Payment not found for reference: ${transactionReference}`);
          res.status(200).json({ received: true });
          return;
        }

        const refundId = String(data?.id ?? data?.refund_id ?? "");

        await AppDataSource.query(
          `UPDATE payments
           SET status = 'REFUNDED',
               refunded_at = now(),
               provider_refund_id = COALESCE(NULLIF($2, ''), provider_refund_id)
           WHERE id = $1 AND status = 'REFUND_PENDING';`,
          [payment.id, refundId]
        );

        res.status(200).json({ received: true });
        return;
      }

      if (event === "refund.failed") {
        const transactionReference =
          data?.transaction_reference || data?.transaction?.reference;

        if (!transactionReference) {
          res.status(200).json({ received: true });
          return;
        }

        const payment = await paymentRepo.findOne({
          where: {
            provider_reference: transactionReference,
            provider: "PAYSTACK",
          },
        });

        if (!payment) {
          console.log(`Payment not found for reference: ${transactionReference}`);
          res.status(200).json({ received: true });
          return;
        }

        await AppDataSource.query(
          `UPDATE payments
           SET status = 'REFUND_FAILED',
               refund_error = 'Refund failed at provider'
           WHERE id = $1 AND status = 'REFUND_PENDING';`,
          [payment.id]
        );

        res.status(200).json({ received: true });
        return;
      }

      if (event === "refund.needs-attention") {
        const transactionReference =
          data?.transaction_reference || data?.transaction?.reference;

        if (!transactionReference) {
          res.status(200).json({ received: true });
          return;
        }

        const payment = await paymentRepo.findOne({
          where: {
            provider_reference: transactionReference,
            provider: "PAYSTACK",
          },
        });

        if (!payment) {
          console.log(`Payment not found for reference: ${transactionReference}`);
          res.status(200).json({ received: true });
          return;
        }

        await AppDataSource.query(
          `UPDATE payments
           SET status = 'REFUND_FAILED',
               refund_error = 'Customer bank details required'
           WHERE id = $1 AND status = 'REFUND_PENDING';`,
          [payment.id]
        );

        res.status(200).json({ received: true });
        return;
      }

      if (event === "refund.pending" || event === "refund.processing") {
        res.status(200).json({ received: true });
        return;
      }

      // Any other event type acknowledged and ignored
      res.status(200).json({ received: true });
    } catch (err: unknown) {
      console.error("Paystack webhook error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
