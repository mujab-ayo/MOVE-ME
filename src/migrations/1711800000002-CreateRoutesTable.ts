import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateRoutesTable1711800000002 implements MigrationInterface {
  name = "CreateRoutesTable1711800000002";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE routes (
        id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pickup_point           TEXT NOT NULL,
        dropoff_point          TEXT NOT NULL,
        base_duration_minutes  INT NOT NULL CHECK (base_duration_minutes > 0),
        base_fare_solo         NUMERIC(10,2) NOT NULL CHECK (base_fare_solo >= 0),
        base_fare_per_seat     NUMERIC(10,2) NOT NULL CHECK (base_fare_per_seat >= 0),
        active                 BOOLEAN NOT NULL DEFAULT true
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS routes;`);
  }
}
