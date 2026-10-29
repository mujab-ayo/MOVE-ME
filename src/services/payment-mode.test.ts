import { simulatedAllowed, defaultProvider } from "./payment-mode";

describe("Payment Mode (simulatedAllowed and defaultProvider)", () => {
  const originalEnv = { ...process.env };

  function restoreEnv(): void {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value !== undefined) {
        process.env[key] = value;
      }
    }
    process.env.NODE_ENV = originalEnv.NODE_ENV || "test";
  }

  afterEach(() => {
    restoreEnv();
  });

  afterAll(() => {
    restoreEnv();
  });

  function setEnv(nodeEnv: string | undefined, allowSimulated: string | undefined): void {
    if (nodeEnv !== undefined) {
      process.env.NODE_ENV = nodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }

    if (allowSimulated !== undefined) {
      process.env.ALLOW_SIMULATED_PAYMENTS = allowSimulated;
    } else {
      delete process.env.ALLOW_SIMULATED_PAYMENTS;
    }
  }

  describe("when NODE_ENV === 'test'", () => {
    it("allows simulated payments when ALLOW_SIMULATED_PAYMENTS is 'true'", () => {
      setEnv("test", "true");
      expect(simulatedAllowed()).toBe(true);
      expect(defaultProvider()).toBe("SIMULATED");
    });

    it("allows simulated payments when ALLOW_SIMULATED_PAYMENTS is 'false'", () => {
      setEnv("test", "false");
      expect(simulatedAllowed()).toBe(true);
      expect(defaultProvider()).toBe("SIMULATED");
    });

    it("allows simulated payments when ALLOW_SIMULATED_PAYMENTS is unset", () => {
      setEnv("test", undefined);
      expect(simulatedAllowed()).toBe(true);
      expect(defaultProvider()).toBe("SIMULATED");
    });
  });

  describe("when NODE_ENV === 'development'", () => {
    it("allows simulated payments when ALLOW_SIMULATED_PAYMENTS is 'true'", () => {
      setEnv("development", "true");
      expect(simulatedAllowed()).toBe(true);
      expect(defaultProvider()).toBe("SIMULATED");
    });

    it("disallows simulated payments and defaults to PAYSTACK when ALLOW_SIMULATED_PAYMENTS is 'false'", () => {
      setEnv("development", "false");
      expect(simulatedAllowed()).toBe(false);
      expect(defaultProvider()).toBe("PAYSTACK");
    });

    it("disallows simulated payments and defaults to PAYSTACK when ALLOW_SIMULATED_PAYMENTS is unset", () => {
      setEnv("development", undefined);
      expect(simulatedAllowed()).toBe(false);
      expect(defaultProvider()).toBe("PAYSTACK");
    });
  });

  describe("when NODE_ENV === 'production'", () => {
    it("disallows simulated payments even when ALLOW_SIMULATED_PAYMENTS is 'true'", () => {
      setEnv("production", "true");
      expect(simulatedAllowed()).toBe(false);
      expect(defaultProvider()).toBe("PAYSTACK");
    });

    it("disallows simulated payments when ALLOW_SIMULATED_PAYMENTS is 'false'", () => {
      setEnv("production", "false");
      expect(simulatedAllowed()).toBe(false);
      expect(defaultProvider()).toBe("PAYSTACK");
    });

    it("disallows simulated payments when ALLOW_SIMULATED_PAYMENTS is unset", () => {
      setEnv("production", undefined);
      expect(simulatedAllowed()).toBe(false);
      expect(defaultProvider()).toBe("PAYSTACK");
    });
  });

  describe("when NODE_ENV is unset", () => {
    it("allows simulated payments when ALLOW_SIMULATED_PAYMENTS is 'true'", () => {
      setEnv(undefined, "true");
      expect(simulatedAllowed()).toBe(true);
      expect(defaultProvider()).toBe("SIMULATED");
    });

    it("disallows simulated payments and defaults to PAYSTACK when ALLOW_SIMULATED_PAYMENTS is 'false'", () => {
      setEnv(undefined, "false");
      expect(simulatedAllowed()).toBe(false);
      expect(defaultProvider()).toBe("PAYSTACK");
    });

    it("disallows simulated payments and defaults to PAYSTACK when ALLOW_SIMULATED_PAYMENTS is unset", () => {
      setEnv(undefined, undefined);
      expect(simulatedAllowed()).toBe(false);
      expect(defaultProvider()).toBe("PAYSTACK");
    });
  });

  describe("Matrix test table for all combinations", () => {
    const matrix = [
      // NODE_ENV = test
      { nodeEnv: "test", flag: "true", expectedAllowed: true, expectedProvider: "SIMULATED" },
      { nodeEnv: "test", flag: "false", expectedAllowed: true, expectedProvider: "SIMULATED" },
      { nodeEnv: "test", flag: undefined, expectedAllowed: true, expectedProvider: "SIMULATED" },

      // NODE_ENV = development
      { nodeEnv: "development", flag: "true", expectedAllowed: true, expectedProvider: "SIMULATED" },
      { nodeEnv: "development", flag: "false", expectedAllowed: false, expectedProvider: "PAYSTACK" },
      { nodeEnv: "development", flag: undefined, expectedAllowed: false, expectedProvider: "PAYSTACK" },

      // NODE_ENV = production
      { nodeEnv: "production", flag: "true", expectedAllowed: false, expectedProvider: "PAYSTACK" },
      { nodeEnv: "production", flag: "false", expectedAllowed: false, expectedProvider: "PAYSTACK" },
      { nodeEnv: "production", flag: undefined, expectedAllowed: false, expectedProvider: "PAYSTACK" },

      // NODE_ENV = unset
      { nodeEnv: undefined, flag: "true", expectedAllowed: true, expectedProvider: "SIMULATED" },
      { nodeEnv: undefined, flag: "false", expectedAllowed: false, expectedProvider: "PAYSTACK" },
      { nodeEnv: undefined, flag: undefined, expectedAllowed: false, expectedProvider: "PAYSTACK" },
    ] as const;

    test.each(matrix)(
      "NODE_ENV=$nodeEnv, ALLOW_SIMULATED_PAYMENTS=$flag -> allowed: $expectedAllowed, provider: $expectedProvider",
      ({ nodeEnv, flag, expectedAllowed, expectedProvider }) => {
        setEnv(nodeEnv, flag);
        expect(simulatedAllowed()).toBe(expectedAllowed);
        expect(defaultProvider()).toBe(expectedProvider);
      }
    );
  });
});
