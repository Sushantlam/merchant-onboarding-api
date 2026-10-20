import { assertKeyLength, open, seal } from './aes-gcm';
import { KeyWrapper } from './key-wrapper';

const VERSION = 'v1';
const KEY_ID_PATTERN = /^[A-Za-z0-9-]{1,32}$/;

export class FieldKeyring {
  constructor(
    private readonly keys: Map<string, Buffer>,
    readonly activeKeyId: string,
  ) {
    if (!keys.has(activeKeyId))
      throw new Error(`Active key "${activeKeyId}" is not in the keyring`);
    keys.forEach((key, id) => assertKeyLength(key, `Data key "${id}"`));
  }

  static async load(
    wrappedKeys: string,
    activeKeyId: string,
    wrapper: KeyWrapper,
  ): Promise<FieldKeyring> {
    const keys = new Map<string, Buffer>();
    for (const entry of wrappedKeys
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)) {
      const [id, wrapped] = entry.split(':');
      if (!KEY_ID_PATTERN.test(id ?? '') || !wrapped) {
        throw new Error(
          'FIELD_ENCRYPTION_DATA_KEYS must look like "id:wrappedKey,id2:wrappedKey2"',
        );
      }
      keys.set(id, await wrapper.unwrap(wrapped));
    }
    return new FieldKeyring(keys, activeKeyId);
  }

  encrypt(plaintext: string): string {
    const sealed = seal(this.keys.get(this.activeKeyId) as Buffer, Buffer.from(plaintext, 'utf8'));
    return `${VERSION}:${this.activeKeyId}:${sealed}`;
  }

  decrypt(value: string): string {
    const [version, keyId, sealed] = value.split(':');
    if (version !== VERSION || !keyId || !sealed) {
      throw new Error('Unrecognised encrypted field format');
    }
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`Unknown encryption key "${keyId}"`);
    return open(key, sealed).toString('utf8');
  }

  isEncrypted(value: string): boolean {
    return value.startsWith(`${VERSION}:`);
  }

  isCurrent(value: string): boolean {
    return value.startsWith(`${VERSION}:${this.activeKeyId}:`);
  }
}
