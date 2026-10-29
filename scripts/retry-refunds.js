require("ts-node").register({ transpileOnly: true });

const dotenv = require("dotenv");
dotenv.config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env", quiet: true });

function extractHost(url) {
  if (!url) return "unknown";
  try {
    const parsed = new URL(url);
    return parsed.hostname || parsed.host;
  } catch {
    const match = url.match(/@([^/?:]+)/);
    return match ? match[1] : "unknown";
  }
}

async function run() {
  const args = process.argv.slice(2);
  if (!args.includes("--yes")) {
    console.error("Refusing to run without --yes");
    process.exit(1);
  }

  const dbHost = extractHost(process.env.DATABASE_URL);
  console.log(`Database host: ${dbHost}`);

  const { AppDataSource } = require("../src/data-source");
  const { requestRefund } = require("../src/services/refund.service");

  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  try {
    const pendingPayments = await AppDataSource.query(`
      SELECT id
      FROM payments
      WHERE provider = 'PAYSTACK'
        AND status = 'REFUND_PENDING'
        AND provider_refund_id IS NULL
      ORDER BY created_at ASC;
    `);

    for (const row of pendingPayments) {
      await requestRefund(row.id);
    }

    let refunded = 0;
    let stillPending = 0;
    let errors = 0;

    for (const row of pendingPayments) {
      const [updated] = await AppDataSource.query(
        `SELECT status, refund_error FROM payments WHERE id = $1;`,
        [row.id]
      );
      if (!updated) continue;
      if (updated.status === "REFUNDED") {
        refunded++;
      } else {
        stillPending++;
        if (updated.refund_error) {
          errors++;
        }
      }
    }

    console.log("Summary:");
    console.log(`- Found: ${pendingPayments.length}`);
    console.log(`- Refunded: ${refunded}`);
    console.log(`- Still pending: ${stillPending}`);
    console.log(`- Errors: ${errors}`);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

if (require.main === module) {
  run().catch((err) => {
    console.error("Failed to run retry-refunds:", err.message);
    process.exit(1);
  });
}
