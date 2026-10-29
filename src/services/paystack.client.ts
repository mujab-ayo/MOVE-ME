export class ProviderError extends Error {
  constructor(message: string, public readonly originalError?: unknown) {
    super(message);
    this.name = "ProviderError";
  }
}

export function getSecretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || key.trim() === "") {
    throw new Error("PAYSTACK_SECRET_KEY is missing");
  }
  if (!key.startsWith("sk_test_")) {
    throw new Error("Invalid Paystack secret key: live keys are not allowed");
  }
  return key;
}

export function toKobo(amount: string): number {
  if (typeof amount !== "string") {
    throw new Error("Amount must be a string");
  }
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid amount format: "${amount}"`);
  }

  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > 2) {
    throw new Error(`Amount cannot have more than two decimal places: "${amount}"`);
  }

  const paddedFraction = fraction.padEnd(2, "0");
  const combined = `${whole}${paddedFraction}`.replace(/^0+(?!$)/, "") || "0";
  return parseInt(combined, 10);
}

export interface InitializeTransactionParams {
  email: string;
  amountKobo: number;
  reference: string;
  callbackUrl: string;
}

export interface InitializeTransactionResult {
  authorizationUrl: string;
  reference: string;
}

export async function initializeTransaction(
  params: InitializeTransactionParams
): Promise<InitializeTransactionResult> {
  const secretKey = getSecretKey();

  const payload = {
    email: params.email,
    amount: params.amountKobo,
    reference: params.reference,
    callback_url: params.callbackUrl,
    currency: "NGN",
  };

  let response: Response;
  try {
    response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err: unknown) {
    throw new ProviderError(
      `Paystack request failed: ${err instanceof Error ? err.message : String(err)}`,
      err
    );
  }

  if (!response.ok) {
    throw new ProviderError(
      `Paystack transaction initialize responded with status ${response.status}`
    );
  }

  let body: any;
  try {
    body = await response.json();
  } catch (err: unknown) {
    throw new ProviderError("Failed to parse Paystack initialize response JSON", err);
  }

  const authorizationUrl = body?.data?.authorization_url;
  if (!authorizationUrl) {
    throw new ProviderError("Paystack initialize response missing authorization_url");
  }

  const returnedRef = body?.data?.reference || params.reference;
  return {
    authorizationUrl,
    reference: returnedRef,
  };
}

export interface CreateRefundParams {
  transactionReference: string;
  merchantNote?: string;
  customerNote?: string;
}

export type RefundStatus = "pending" | "processing" | "processed" | "failed";

export interface CreateRefundResult {
  refundId: string;
  status: RefundStatus;
}

export async function createRefund(
  params: CreateRefundParams
): Promise<CreateRefundResult> {
  const secretKey = getSecretKey();

  const payload: Record<string, any> = {
    transaction: params.transactionReference,
    merchant_note: params.merchantNote,
    customer_note: params.customerNote,
  };

  let response: Response;
  try {
    response = await fetch("https://api.paystack.co/refund", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err: unknown) {
    throw new ProviderError(
      `Paystack refund request failed: ${err instanceof Error ? err.message : "network error"}`
    );
  }

  if (!response.ok) {
    throw new ProviderError(`Paystack refund responded with status ${response.status}`);
  }

  let body: any;
  try {
    body = await response.json();
  } catch (err: unknown) {
    throw new ProviderError("Failed to parse Paystack refund response JSON");
  }

  const refundId = String(body?.data?.id ?? body?.data?.refund_id ?? "");
  if (!refundId) {
    throw new ProviderError("Paystack refund response missing refund id");
  }

  const rawStatus = String(body?.data?.status ?? "pending").toLowerCase();
  const validStatuses: RefundStatus[] = ["pending", "processing", "processed", "failed"];
  const status: RefundStatus = validStatuses.includes(rawStatus as RefundStatus)
    ? (rawStatus as RefundStatus)
    : "pending";

  return {
    refundId,
    status,
  };
}

