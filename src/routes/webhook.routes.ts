import { Router, Request, Response } from "express";
import crypto from "crypto";
import { AppDataSource } from "../data-source";
import { Payment } from "../entities/payment.entity";
import { getSecretKey, toKobo } from "../services/paystack.client";
import { applyPaymentOutcome } from "../services/payment-outcome.service";

const router = Router();

/**
 * @openapi
 * /webhooks/paystack:
 *   post:
 *     summary: Paystack payment gateway webhook listener (Public).
 *     description: Receives and verifies HMAC SHA512 signature of incoming Paystack webhook events.
 *     tags:
 *       - Payments
 *     parameters:
 *       - in: header
 *         name: x-paystack-signature
 *         required: true
 *         schema:
 *           type: string
 *         description: HMAC SHA512 signature of request body
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
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
 *       401:
 *         description: Invalid signature
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
      if (event !== "charge.success") {
        res.status(200).json({ received: true });
        return;
      }

      const data = req.body?.data;
      const reference = data?.reference;

      if (!reference) {
        res.status(200).json({ received: true });
        return;
      }

      const paymentRepo = AppDataSource.getRepository(Payment);
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

      await applyPaymentOutcome(payment.id, "SUCCESS");
      res.status(200).json({ received: true });
    } catch (err: unknown) {
      console.error("Paystack webhook error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
