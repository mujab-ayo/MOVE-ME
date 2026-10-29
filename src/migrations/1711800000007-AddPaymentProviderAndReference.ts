import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPaymentProviderAndReference1711800000007 implements MigrationInterface {
  name = "AddPaymentProviderAndReference1711800000007";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE payments
        ADD COLUMN provider TEXT NOT NULL DEFAULT 'SIMULATED'
          CHECK (provider IN ('SIMULATED','PAYSTACK'));
    `);

    await queryRunner.query(`
      ALTER TABLE payments
        ADD COLUMN provider_reference TEXT NULL;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX idx_payments_provider_reference
        ON payments (provider_reference)
        WHERE provider_reference IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_payments_provider_reference;`);

    await queryRunner.query(`
      ALTER TABLE payments
        DROP COLUMN IF EXISTS provider_reference;
    `);

    await queryRunner.query(`
      ALTER TABLE payments
        DROP COLUMN IF EXISTS provider;
    `);
  }
}
