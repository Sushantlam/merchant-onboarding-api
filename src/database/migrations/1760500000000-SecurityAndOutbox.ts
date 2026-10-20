import { MigrationInterface, QueryRunner } from 'typeorm';
import { loadFieldKeyring } from '../../common/crypto/field-encryption';
import { FieldKeyring } from '../../common/crypto/field-keyring';

const ENCRYPTED_COLUMNS = ['tax_id', 'owner_name', 'owner_email', 'owner_phone'];

export class SecurityAndOutbox1760500000000 implements MigrationInterface {
  name = 'SecurityAndOutbox1760500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "family_id" uuid NOT NULL,
        "token_hash" varchar NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "revoked_at" timestamptz,
        "replaced_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_refresh_tokens_hash" UNIQUE ("token_hash")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_refresh_tokens_family" ON "refresh_tokens" ("family_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "outbox_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "type" varchar NOT NULL,
        "payload" jsonb NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "last_error" text,
        "available_at" timestamptz NOT NULL DEFAULT now(),
        "processed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_outbox_events_pending" ON "outbox_events" ("available_at") WHERE "processed_at" IS NULL`,
    );

    for (const column of ENCRYPTED_COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "merchant_applications" ALTER COLUMN "${column}" TYPE text`,
      );
    }
    await this.transformExisting(queryRunner, (keyring, value) =>
      keyring.isEncrypted(value) ? value : keyring.encrypt(value),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.transformExisting(queryRunner, (keyring, value) =>
      keyring.isEncrypted(value) ? keyring.decrypt(value) : value,
    );
    for (const column of ENCRYPTED_COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "merchant_applications" ALTER COLUMN "${column}" TYPE varchar`,
      );
    }
    await queryRunner.query(`DROP TABLE "outbox_events"`);
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
  }

  private async transformExisting(
    queryRunner: QueryRunner,
    transform: (keyring: FieldKeyring, value: string) => string,
  ): Promise<void> {
    const rows: Record<string, string>[] = await queryRunner.query(
      `SELECT "id", ${ENCRYPTED_COLUMNS.map((c) => `"${c}"`).join(', ')} FROM "merchant_applications"`,
    );
    if (!rows.length) return;

    const keyring = await loadFieldKeyring();
    for (const row of rows) {
      const values = ENCRYPTED_COLUMNS.map((column) => transform(keyring, row[column]));
      await queryRunner.query(
        `UPDATE "merchant_applications" SET ${ENCRYPTED_COLUMNS.map((c, i) => `"${c}" = $${i + 2}`).join(', ')} WHERE "id" = $1`,
        [row.id, ...values],
      );
    }
  }
}
