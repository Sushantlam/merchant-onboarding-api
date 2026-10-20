import { randomBytes } from 'crypto';
import { FieldKeyring } from '../src/common/crypto/field-keyring';
import { LocalKeyWrapper } from '../src/common/crypto/key-wrapper';
import { loadFieldKeyring, useFieldKeyring } from '../src/common/crypto/field-encryption';
import { reencryptApplications } from '../src/database/reencrypt-applications';
import { auth, createApplication, createTestApp, TestContext } from './test-app';

describe('Field encryption key rotation (e2e)', () => {
  let ctx: TestContext;
  let original: FieldKeyring;
  let rotated: FieldKeyring;

  beforeAll(async () => {
    ctx = await createTestApp();
    original = await loadFieldKeyring();
  });

  afterAll(async () => {
    useFieldKeyring(original);
    await ctx.app.close();
  });

  const rawRow = async (id: string) =>
    (
      await ctx.dataSource.query(
        'SELECT tax_id, owner_name, owner_email, owner_phone FROM merchant_applications WHERE id = $1',
        [id],
      )
    )[0] as Record<string, string>;

  it('moves existing rows to the new key while old values stay readable', async () => {
    const id = await createApplication(ctx, ctx.users.sales, { taxId: '77-1234567' });
    expect((await rawRow(id)).tax_id.startsWith('v1:test:')).toBe(true);

    const wrapper = new LocalKeyWrapper(
      Buffer.from(process.env.FIELD_ENCRYPTION_MASTER_KEY as string, 'base64'),
    );
    rotated = await FieldKeyring.load(
      `${process.env.FIELD_ENCRYPTION_DATA_KEYS},next:${await wrapper.wrap(randomBytes(32))}`,
      'next',
      wrapper,
    );
    useFieldKeyring(rotated);

    const before = await ctx.http().get(`/applications/${id}`).set(auth(ctx.users.sales));
    expect(before.body.taxIdMasked).toBe('******4567');

    const updated = await reencryptApplications(ctx.dataSource, rotated);
    expect(updated).toBeGreaterThanOrEqual(1);

    const row = await rawRow(id);
    expect(Object.values(row).every((value) => value.startsWith('v1:next:'))).toBe(true);
    expect(rotated.decrypt(row.tax_id)).toBe('77-1234567');

    expect(await reencryptApplications(ctx.dataSource, rotated)).toBe(0);

    const after = await ctx.http().get(`/applications/${id}`).set(auth(ctx.users.sales));
    expect(after.body).toMatchObject({
      taxIdMasked: '******4567',
      ownerEmail: 'owner@example.com',
    });
  });

  it('encrypts any plaintext left over from before encryption was enabled', async () => {
    const id = await createApplication(ctx, ctx.users.sales);
    await ctx.dataSource.query(
      `UPDATE merchant_applications SET owner_phone = '+44 20 7946 0123' WHERE id = $1`,
      [id],
    );

    await reencryptApplications(ctx.dataSource, rotated);

    const row = await rawRow(id);
    expect(row.owner_phone.startsWith('v1:next:')).toBe(true);
    expect(rotated.decrypt(row.owner_phone)).toBe('+44 20 7946 0123');
  });
});
