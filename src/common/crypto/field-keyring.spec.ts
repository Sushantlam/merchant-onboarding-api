import { randomBytes } from 'crypto';
import { FieldKeyring } from './field-keyring';
import { LocalKeyWrapper } from './key-wrapper';

describe('FieldKeyring', () => {
  const wrapper = new LocalKeyWrapper(randomBytes(32));
  const keyA = randomBytes(32);
  const keyB = randomBytes(32);

  const keyringWith = async (active: string, entries: Array<[string, Buffer]>) => {
    const wrapped = await Promise.all(
      entries.map(async ([id, key]) => `${id}:${await wrapper.wrap(key)}`),
    );
    return FieldKeyring.load(wrapped.join(','), active, wrapper);
  };

  it('round trips a value and tags it with the active key id', async () => {
    const keyring = await keyringWith('a', [['a', keyA]]);
    const encrypted = keyring.encrypt('12-3456789');

    expect(encrypted.startsWith('v1:a:')).toBe(true);
    expect(encrypted).not.toContain('12-3456789');
    expect(keyring.decrypt(encrypted)).toBe('12-3456789');
  });

  it('uses a fresh iv for every value', async () => {
    const keyring = await keyringWith('a', [['a', keyA]]);
    expect(keyring.encrypt('same')).not.toBe(keyring.encrypt('same'));
  });

  it('keeps reading values written with an older key after rotation', async () => {
    const before = await keyringWith('a', [['a', keyA]]);
    const old = before.encrypt('owner@example.com');

    const after = await keyringWith('b', [
      ['a', keyA],
      ['b', keyB],
    ]);

    expect(after.decrypt(old)).toBe('owner@example.com');
    expect(after.isCurrent(old)).toBe(false);
    expect(after.isCurrent(after.encrypt('owner@example.com'))).toBe(true);
  });

  it('fails loudly for a retired key or a tampered value', async () => {
    const keyring = await keyringWith('a', [['a', keyA]]);
    const onlyB = await keyringWith('b', [['b', keyB]]);
    const encrypted = keyring.encrypt('secret');

    expect(() => onlyB.decrypt(encrypted)).toThrow('Unknown encryption key "a"');

    const tampered = encrypted.slice(0, -4) + (encrypted.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(() => keyring.decrypt(tampered)).toThrow();
  });

  it('cannot unwrap data keys with the wrong master key', async () => {
    const wrapped = `a:${await wrapper.wrap(keyA)}`;
    const otherMaster = new LocalKeyWrapper(randomBytes(32));

    await expect(FieldKeyring.load(wrapped, 'a', otherMaster)).rejects.toThrow();
  });

  it('validates its configuration', async () => {
    await expect(keyringWith('missing', [['a', keyA]])).rejects.toThrow('not in the keyring');
    await expect(FieldKeyring.load('not-valid', 'a', wrapper)).rejects.toThrow('id:wrappedKey');
    await expect(keyringWith('a', [['a', randomBytes(16)]])).rejects.toThrow('32 bytes');
    expect(() => new LocalKeyWrapper(randomBytes(8))).toThrow('32 bytes');
  });
});
