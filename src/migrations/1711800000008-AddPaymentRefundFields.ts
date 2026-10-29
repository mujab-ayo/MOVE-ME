import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPaymentRefundFields1711800000008 implements MigrationInterface {
  name = "AddPaymentRefundFields1711800000008";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE payments
        ADD COLUMN provider_refund_id TEXT NULL,
        ADD COLUMN refund_requested_at TIMESTAMPTZ NULL,
        ADD COLUMN refund_claimed_at TIMESTAMPTZ NULL,
        ADD COLUMN refund_attempts INT NOT NULL DEFAULT 0,
        ADD COLUMN refund_error TEXT NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
    `);

    await queryRunner.query(`
      ALTER TABLE payments ADD CONSTRAINT payments_status_check
        CHECK (status IN ('PENDING','SUCCEEDED','FAILED','EXPIRED','REFUNDED','REFUND_PENDING','REFUND_FAILED'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
    `);

    await queryRunner.query(`
      ALTER TABLE payments ADD CONSTRAINT payments_status_check
        CHECK (status IN ('PENDING','SUCCEEDED','FAILED','EXPIRED','REFUNDED'));
    `);

    await queryRunner.query(`
      ALTER TABLE payments
        DROP COLUMN IF EXISTS refund_error,
        DROP COLUMN IF EXISTS refund_attempts,
        DROP COLUMN IF EXISTS refund_claimed_at,
        DROP COLUMN IF EXISTS refund_requested_at,
        DROP COLUMN IF EXISTS provider_refund_id;
    `);
  }
}
