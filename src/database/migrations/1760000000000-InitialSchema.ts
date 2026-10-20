import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1760000000000 implements MigrationInterface {
  name = 'InitialSchema1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" varchar NOT NULL,
        "full_name" varchar NOT NULL,
        "password_hash" varchar NOT NULL,
        "role" varchar NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_users_email" UNIQUE ("email"),
        CONSTRAINT "chk_users_role" CHECK ("role" IN ('ADMIN', 'REVIEWER', 'SALES'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "merchant_applications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "business_name" varchar NOT NULL,
        "legal_business_name" varchar NOT NULL,
        "business_type" varchar NOT NULL,
        "tax_id" varchar NOT NULL,
        "owner_name" varchar NOT NULL,
        "owner_email" varchar NOT NULL,
        "owner_phone" varchar NOT NULL,
        "monthly_volume" numeric(14,2) NOT NULL,
        "average_ticket" numeric(12,2) NOT NULL,
        "merchant_category_code" varchar(4) NOT NULL,
        "status" varchar NOT NULL DEFAULT 'DRAFT',
        "risk_status" varchar NOT NULL DEFAULT 'NOT_STARTED',
        "risk_score" integer,
        "submission_count" integer NOT NULL DEFAULT 0,
        "decision_note" text,
        "created_by_id" uuid NOT NULL REFERENCES "users"("id"),
        "assigned_reviewer_id" uuid REFERENCES "users"("id"),
        "submitted_at" timestamptz,
        "decided_at" timestamptz,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_applications_status" CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'INFO_REQUESTED', 'APPROVED', 'REJECTED')),
        CONSTRAINT "chk_applications_risk_status" CHECK ("risk_status" IN ('NOT_STARTED', 'PENDING', 'LOW', 'MEDIUM', 'HIGH', 'FAILED')),
        CONSTRAINT "chk_applications_business_type" CHECK ("business_type" IN ('SOLE_PROPRIETOR', 'PARTNERSHIP', 'LLC', 'CORPORATION', 'NON_PROFIT')),
        CONSTRAINT "chk_applications_amounts" CHECK ("monthly_volume" > 0 AND "average_ticket" > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_applications_created_by" ON "merchant_applications" ("created_by_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_applications_reviewer" ON "merchant_applications" ("assigned_reviewer_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_applications_status" ON "merchant_applications" ("status", "created_at" DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE "risk_checks" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "application_id" uuid NOT NULL REFERENCES "merchant_applications"("id") ON DELETE CASCADE,
        "submission_number" integer NOT NULL,
        "provider_reference" varchar NOT NULL,
        "score" integer NOT NULL,
        "outcome" varchar NOT NULL,
        "reasons" jsonb NOT NULL DEFAULT '[]',
        "attempts" integer NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_risk_checks_application_submission" UNIQUE ("application_id", "submission_number")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "action" varchar NOT NULL,
        "entity_type" varchar NOT NULL,
        "entity_id" uuid NOT NULL,
        "actor_id" uuid,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_entity" ON "audit_logs" ("entity_type", "entity_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP TABLE "risk_checks"`);
    await queryRunner.query(`DROP TABLE "merchant_applications"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
