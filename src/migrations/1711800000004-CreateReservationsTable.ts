import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateReservationsTable1711800000004 implements MigrationInterface {
  name = "CreateReservationsTable1711800000004";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE reservations (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        departure_id         UUID NOT NULL REFERENCES departures(id),
        passenger_id         UUID NOT NULL REFERENCES users(id),
        status               TEXT NOT NULL DEFAULT 'PENDING_PAYMENT'
                              CHECK (status IN ('PENDING_PAYMENT','CONFIRMED','FAILED','EXPIRED','CANCELLED','COMPLETED')),
        fare_amount          NUMERIC(10,2) NOT NULL,
        hold_expires_at      TIMESTAMPTZ NOT NULL,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
        cancelled_at         TIMESTAMPTZ,
        cancellation_reason  TEXT
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX one_active_reservation_per_passenger_per_departure
        ON reservations (departure_id, passenger_id)
        WHERE status IN ('PENDING_PAYMENT','CONFIRMED');
    `);

    await queryRunner.query(`
      CREATE INDEX reservations_departure_status_idx
        ON reservations (departure_id, status, hold_expires_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS reservations_departure_status_idx;`);
    await queryRunner.query(`DROP INDEX IF EXISTS one_active_reservation_per_passenger_per_departure;`);
    await queryRunner.query(`DROP TABLE IF EXISTS reservations;`);
  }
}
