import { assertKeyLength, open, seal } from './aes-gcm';

export interface KeyWrapper {
  wrap(dataKey: Buffer): Promise<string>;
  unwrap(wrappedKey: string): Promise<Buffer>;
}

export class LocalKeyWrapper implements KeyWrapper {
  private readonly masterKey: Buffer;

  constructor(masterKey: Buffer) {
    this.masterKey = assertKeyLength(masterKey, 'FIELD_ENCRYPTION_MASTER_KEY');
  }

  async wrap(dataKey: Buffer): Promise<string> {
    return seal(this.masterKey, dataKey);
  }

  async unwrap(wrappedKey: string): Promise<Buffer> {
    return open(this.masterKey, wrappedKey);
  }
}

export function createKeyWrapper(env: NodeJS.ProcessEnv): KeyWrapper {
  if (!env.FIELD_ENCRYPTION_MASTER_KEY) throw new Error('FIELD_ENCRYPTION_MASTER_KEY is not set');
  return new LocalKeyWrapper(Buffer.from(env.FIELD_ENCRYPTION_MASTER_KEY, 'base64'));
}
