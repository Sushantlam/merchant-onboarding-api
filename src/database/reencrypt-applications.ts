import { DataSource } from 'typeorm';
import { FieldKeyring } from '../common/crypto/field-keyring';

export const ENCRYPTED_APPLICATION_COLUMNS = ['tax_id', 'owner_name', 'owner_email', 'owner_phone'];

const BATCH_SIZE = 200;

export async function reencryptApplications(
  dataSource: DataSource,
  keyring: FieldKeyring,
): Promise<number> {
  const columns = ENCRYPTED_APPLICATION_COLUMNS;
  let lastId = '00000000-0000-0000-0000-000000000000';
  let updated = 0;

  for (;;) {
    const rows: Record<string, string>[] = await dataSource.query(
      `SELECT "id", ${columns.map((c) => `"${c}"`).join(', ')} FROM "merchant_applications"
       WHERE "id" > $1 ORDER BY "id" LIMIT $2`,
      [lastId, BATCH_SIZE],
    );
    if (!rows.length) return updated;

    for (const row of rows) {
      lastId = row.id;
      if (columns.every((column) => keyring.isCurrent(row[column]))) continue;

      const values = columns.map((column) =>
        keyring.encrypt(
          keyring.isEncrypted(row[column]) ? keyring.decrypt(row[column]) : row[column],
        ),
      );
      await dataSource.query(
        `UPDATE "merchant_applications" SET ${columns.map((c, i) => `"${c}" = $${i + 2}`).join(', ')} WHERE "id" = $1`,
        [row.id, ...values],
      );
      updated += 1;
    }
  }
}
