import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateDeparturesTable1711800000003 implements MigrationInterface {
  name = "CreateDeparturesTable1711800000003";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS btree_gist;`);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION departure_end_time(ts TIMESTAMPTZ, mins INT)
      RETURNS TIMESTAMPTZ
      LANGUAGE sql
      IMMUTABLE
      AS $$
        SELECT ts + (mins * interval '1 minute');
      $$;
    `);

    await queryRunner.query(`
      CREATE TABLE departures (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        driver_id         UUID NOT NULL REFERENCES users(id),
        vehicle_id        UUID NOT NULL REFERENCES vehicles(id),
        route_id          UUID NOT NULL REFERENCES routes(id),
        mode              TEXT NOT NULL CHECK (mode IN ('SOLO','POOLED')),
        departure_time    TIMESTAMPTZ NOT NULL,
        duration_minutes  INT NOT NULL CHECK (duration_minutes > 0),
        fare_amount       NUMERIC(10,2) NOT NULL CHECK (fare_amount >= 0),
        capacity          INT NOT NULL CHECK (capacity > 0),
        status            TEXT NOT NULL DEFAULT 'SCHEDULED'
                           CHECK (status IN ('SCHEDULED','ARRIVED','IN_PROGRESS','COMPLETED','CANCELLED')),
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

        -- MM-02: no overlapping active departures for the same driver.
        -- Half-open range + '[)' bound makes touching boundaries legal.
        EXCLUDE USING gist (
          driver_id WITH =,
          tstzrange(departure_time, departure_end_time(departure_time, duration_minutes), '[)') WITH &&
        ) WHERE (status <> 'CANCELLED'),

        -- MM-02: same rule for the vehicle.
        EXCLUDE USING gist (
          vehicle_id WITH =,
          tstzrange(departure_time, departure_end_time(departure_time, duration_minutes), '[)') WITH &&
        ) WHERE (status <> 'CANCELLED')
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX one_active_trip_per_driver
        ON departures (driver_id)
        WHERE status IN ('ARRIVED','IN_PROGRESS');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS one_active_trip_per_driver;`);
    await queryRunner.query(`DROP TABLE IF EXISTS departures;`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS departure_end_time;`);
  }
}
