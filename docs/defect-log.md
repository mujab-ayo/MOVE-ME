# Defect Log & Known Limitations

This document tracks known limitations, platform edge cases, and operational recovery procedures for the MoveMe platform.

---

## 1. Paystack Payments & Refund Limitations

1. **Test Mode Operation**:
   - Paystack integration operates in test mode (`PAYSTACK_SECRET_KEY` begins with `sk_test_`).
   - In test mode, no real money moves.
   - Refunds for Paystack payments are requested from Paystack automatically under three conditions:
     - Passenger cancellation of a confirmed reservation (`POST /reservations/:id/cancel`).
     - Driver cancellation of an active departure (`POST /departures/:id/cancel`).
     - Payments that arrive too late (after the 10-minute hold has elapsed or after departure cancellation).

2. **Failed Refund Retries (`REFUND_PENDING`)**:
   - If an automated refund request to the Paystack API fails (e.g., transient network failure or provider unavailability), the payment status remains `REFUND_PENDING` rather than failing permanently.
   - Pending refunds are retried using the refund retry script:
     ```bash
     npm run refunds:retry -- --yes
     ```
   - This script must be run from your own machine with the `--yes` flag against the environment database.

3. **Refunds Needing Attention (`refund.needs-attention`)**:
   - Paystack can mark a refund as needing attention (e.g., when customer bank details are required to process the refund).
   - In this scenario, the webhook marks the payment as `REFUND_FAILED` with `refund_error = 'Customer bank details required'`.
   - Resolution is handled directly in the Paystack merchant dashboard.

4. **Abandoned Checkouts**:
   - If a customer navigates to the Paystack checkout page and abandons the session without completing payment, Paystack produces no webhook event.
   - The reservation seat hold simply expires automatically when `hold_expires_at` is reached, freeing the seat for other passengers.
