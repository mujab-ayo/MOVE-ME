import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTripProgressCancellationAndNotifications1711800000006 implements MigrationInterface {
  name = "AddTripProgressCancellationAndNotifications1711800000006";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE departures
        ADD COLUMN arrived_at TIMESTAMPTZ,
        ADD COLUMN departed_at TIMESTAMPTZ,
        ADD COLUMN completed_at TIMESTAMPTZ,
        ADD COLUMN cancelled_at TIMESTAMPTZ,
        ADD COLUMN cancellation_reason TEXT;
    `);

    await queryRunner.query(`
      ALTER TABLE payments
        ADD COLUMN refunded_at TIMESTAMPTZ;
    `);

    await queryRunner.query(`
      CREATE TABLE notifications (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID NOT NULL REFERENCES users(id),
        type        TEXT NOT NULL,
        payload     JSONB NOT NULL,
        read_at     TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX notifications_user_id_created_at_idx
        ON notifications (user_id, created_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS notifications_user_id_created_at_idx;`);
    await queryRunner.query(`DROP TABLE IF EXISTS notifications;`);

    await queryRunner.query(`
      ALTER TABLE payments
        DROP COLUMN IF EXISTS refunded_at;
    `);

    await queryRunner.query(`
      ALTER TABLE departures
        DROP COLUMN IF EXISTS arrived_at,
        DROP COLUMN IF EXISTS departed_at,
        DROP COLUMN IF EXISTS completed_at,
        DROP COLUMN IF EXISTS cancelled_at,
        DROP COLUMN IF EXISTS cancellation_reason;
    `);
  }
}
