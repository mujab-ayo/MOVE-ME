import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateUsersTable1711800000000 implements MigrationInterface {
  name = "CreateUsersTable1711800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS citext;`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS btree_gist;`);

    await queryRunner.query(`
      CREATE TABLE users (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email            CITEXT NOT NULL UNIQUE,
        password_hash    TEXT NOT NULL,
        role             TEXT NOT NULL CHECK (role IN ('PASSENGER','DRIVER','ADMIN')),
        driver_enabled   BOOLEAN NOT NULL DEFAULT false,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS users;`);
  }
}
