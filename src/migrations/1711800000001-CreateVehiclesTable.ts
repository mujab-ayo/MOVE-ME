import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateVehiclesTable1711800000001 implements MigrationInterface {
  name = "CreateVehiclesTable1711800000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE vehicles (
        id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        driver_id                UUID NOT NULL REFERENCES users(id),
        description              TEXT NOT NULL,
        registration_identifier  TEXT NOT NULL UNIQUE,
        seat_capacity            INT NOT NULL CHECK (seat_capacity > 0),
        active                   BOOLEAN NOT NULL DEFAULT true,
        created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS vehicles;`);
  }
}
