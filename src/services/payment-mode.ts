export type PaymentProvider = "SIMULATED" | "PAYSTACK";

export function simulatedAllowed(): boolean {
  const nodeEnv = process.env.NODE_ENV;

  if (nodeEnv === "test") {
    return true;
  }

  if (nodeEnv !== "production" && process.env.ALLOW_SIMULATED_PAYMENTS === "true") {
    return true;
  }

  return false;
}

export function defaultProvider(): PaymentProvider {
  return simulatedAllowed() ? "SIMULATED" : "PAYSTACK";
}
