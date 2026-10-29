import { AppDataSource } from "../data-source";
import { createRefund } from "./paystack.client";

export async function requestRefund(paymentId: string): Promise<void> {
  try {
    const rawResult = await AppDataSource.query(
      `UPDATE payments
       SET refund_attempts = refund_attempts + 1, refund_claimed_at = now()
       WHERE id = $1
         AND provider = 'PAYSTACK'
         AND status = 'REFUND_PENDING'
         AND provider_refund_id IS NULL
         AND (refund_claimed_at IS NULL OR refund_claimed_at < now() - interval '2 minutes')
       RETURNING id, provider_reference, amount;`,
      [paymentId]
    );

    const rows =
      Array.isArray(rawResult) && Array.isArray(rawResult[0])
        ? rawResult[0]
        : Array.isArray(rawResult)
        ? rawResult
        : [];

    if (!rows || rows.length === 0) {
      return;
    }

    const row = rows[0];

    let refundResult;
    try {
      refundResult = await createRefund({
        transactionReference: row.provider_reference,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`Refund failed for payment ${paymentId}`);
      await AppDataSource.query(
        `UPDATE payments
         SET refund_error = $2
         WHERE id = $1 AND status = 'REFUND_PENDING'`,
        [paymentId, errorMsg]
      );
      return;
    }

    if (refundResult.status === "processed") {
      await AppDataSource.query(
        `UPDATE payments
         SET status = 'REFUNDED', refunded_at = now(), provider_refund_id = $2
         WHERE id = $1 AND status = 'REFUND_PENDING'`,
        [paymentId, refundResult.refundId]
      );
    } else {
      await AppDataSource.query(
        `UPDATE payments
         SET provider_refund_id = $2
         WHERE id = $1 AND status = 'REFUND_PENDING'`,
        [paymentId, refundResult.refundId]
      );
    }
  } catch (err: unknown) {
    console.error(`Refund failed for payment ${paymentId}`);
  }
}
