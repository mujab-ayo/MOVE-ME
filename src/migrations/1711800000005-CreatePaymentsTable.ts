import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePaymentsTable1711800000005 implements MigrationInterface {
  name = "CreatePaymentsTable1711800000005";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE payments (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reservation_id   UUID NOT NULL REFERENCES reservations(id),
        amount           NUMERIC(10,2) NOT NULL,
        status           TEXT NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','SUCCEEDED','FAILED','EXPIRED','REFUNDED')),
        idempotency_key  TEXT NOT NULL UNIQUE,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at     TIMESTAMPTZ
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX one_successful_payment_per_reservation
        ON payments (reservation_id)
        WHERE status = 'SUCCEEDED';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS one_successful_payment_per_reservation;`);
    await queryRunner.query(`DROP TABLE IF EXISTS payments;`);
  }
}
