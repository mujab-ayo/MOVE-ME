import { AppDataSource } from "../data-source";

export type PaymentOutcomeResult =
  | { status: "SUCCEEDED"; reservationStatus: "CONFIRMED" }
  | { status: "FAILED"; reservationStatus: "FAILED" }
  | { status: "IGNORED"; message: string; paymentStatus?: string }
  | { error: string };

export async function applyPaymentOutcome(
  paymentId: string,
  outcome: string
): Promise<PaymentOutcomeResult> {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();

  try {
    // 1. Read the payment (no lock) to get reservation_id, then the reservation's departure_id
    const paymentsPrelim = await queryRunner.query(
      `SELECT id, reservation_id, status
       FROM payments
       WHERE id = $1;`,
      [paymentId]
    );

    if (paymentsPrelim.length === 0) {
      return { error: "Payment not found" };
    }

    const paymentPrelim = paymentsPrelim[0];

    // If payment is already resolved (no longer PENDING), treat as no-op
    if (paymentPrelim.status !== "PENDING") {
      return {
        status: "IGNORED",
        message: `Payment already resolved with status ${paymentPrelim.status}`,
        paymentStatus: paymentPrelim.status,
      };
    }

    const reservationsPrelim = await queryRunner.query(
      `SELECT id, departure_id
       FROM reservations
       WHERE id = $1;`,
      [paymentPrelim.reservation_id]
    );

    if (reservationsPrelim.length === 0) {
      return { error: "Associated reservation not found" };
    }

    const departureId = reservationsPrelim[0].departure_id;

    // 2. BEGIN, then SELECT the departure FOR UPDATE first (same lock, same order as the booking endpoint: departure before reservation)
    await queryRunner.startTransaction();

    const departures = await queryRunner.query(
      `SELECT id, status
       FROM departures
       WHERE id = $1
       FOR UPDATE;`,
      [departureId]
    );

    if (departures.length === 0) {
      await queryRunner.rollbackTransaction();
      return { error: "Associated departure not found" };
    }

    const departure = departures[0];

    // 3. Lock payment FOR UPDATE, then reservation FOR UPDATE, and re-verify their statuses under the locks
    const payments = await queryRunner.query(
      `SELECT id, reservation_id, amount, status, idempotency_key
       FROM payments
       WHERE id = $1
       FOR UPDATE;`,
      [paymentId]
    );

    if (payments.length === 0) {
      await queryRunner.rollbackTransaction();
      return { error: "Payment not found" };
    }

    const payment = payments[0];

    // Re-verify payment status under the lock
    if (payment.status !== "PENDING") {
      await queryRunner.commitTransaction();
      return {
        status: "IGNORED",
        message: `Payment already resolved with status ${payment.status}`,
        paymentStatus: payment.status,
      };
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
      return { error: "Associated reservation not found" };
    }

    const reservation = reservations[0];

    // Re-verify reservation status, hold validity, and departure status under the locks
    const isStillPending = reservation.status === "PENDING_PAYMENT";
    const isHoldValid = reservation.is_hold_valid === true;
    const isDepartureValid =
      departure.status === "SCHEDULED" || departure.status === "ARRIVED";
    const isReservationStillValid =
      isStillPending && isHoldValid && isDepartureValid;

    if (!isReservationStillValid) {
      // Late callback on an expired or invalid reservation — treat it as a no-op (don't confirm, don't error loudly)
      // Update payment to EXPIRED if it's still PENDING
      await queryRunner.query(
        `UPDATE payments
         SET status = 'EXPIRED', completed_at = now()
         WHERE id = $1 AND status = 'PENDING';`,
        [paymentId]
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

      return {
        status: "IGNORED",
        message: "Late callback on expired reservation - payment marked EXPIRED",
        paymentStatus: "EXPIRED",
      };
    }

    // 4. Reservation is valid and unexpired:
    if (outcome === "SUCCESS") {
      try {
        // Update payment to SUCCEEDED
        await queryRunner.query(
          `UPDATE payments
           SET status = 'SUCCEEDED', completed_at = now()
           WHERE id = $1;`,
          [paymentId]
        );

        // Update reservation to CONFIRMED
        await queryRunner.query(
          `UPDATE reservations
           SET status = 'CONFIRMED'
           WHERE id = $1;`,
          [reservation.id]
        );

        await queryRunner.commitTransaction();

        return {
          status: "SUCCEEDED",
          reservationStatus: "CONFIRMED",
        };
      } catch (innerErr: any) {
        // Rely on the one_successful_payment_per_reservation unique index as the backstop
        // against a duplicate success — catch that specific constraint violation and treat it as a no-op too
        if (
          innerErr.code === "23505" &&
          (innerErr.constraint?.includes("one_successful_payment") ||
            innerErr.detail?.includes("Key (reservation_id)"))
        ) {
          await queryRunner.rollbackTransaction();
          return {
            status: "IGNORED",
            message: "Duplicate successful payment for reservation - ignored",
          };
        }
        throw innerErr;
      }
    } else {
      // outcome === 'FAILURE': update payment to FAILED, reservation to FAILED
      await queryRunner.query(
        `UPDATE payments
         SET status = 'FAILED', completed_at = now()
         WHERE id = $1;`,
        [paymentId]
      );

      await queryRunner.query(
        `UPDATE reservations
         SET status = 'FAILED'
         WHERE id = $1;`,
        [reservation.id]
      );

      await queryRunner.commitTransaction();

      return {
        status: "FAILED",
        reservationStatus: "FAILED",
      };
    }
  } catch (err: any) {
    if (queryRunner.isTransactionActive) {
      await queryRunner.rollbackTransaction();
    }
    throw err;
  } finally {
    await queryRunner.release();
  }
}
