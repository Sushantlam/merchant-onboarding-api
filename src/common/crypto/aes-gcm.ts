import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

export function seal(key: Buffer, plaintext: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64')).join('.');
}

export function open(key: Buffer, sealed: string): Buffer {
  const [iv, tag, encrypted] = sealed.split('.');
  if (!iv || !tag || !encrypted) throw new Error('Malformed sealed value');
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]);
}

export function assertKeyLength(key: Buffer, name: string): Buffer {
  if (key.length !== 32) throw new Error(`${name} must be 32 bytes, base64 encoded`);
  return key;
}
