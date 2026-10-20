import { ValueTransformer } from 'typeorm';
import { FieldKeyring } from './field-keyring';
import { createKeyWrapper } from './key-wrapper';

let keyring: FieldKeyring | undefined;

export function useFieldKeyring(value: FieldKeyring): void {
  keyring = value;
}

export async function loadFieldKeyring(
  env: NodeJS.ProcessEnv = process.env,
): Promise<FieldKeyring> {
  const loaded = await FieldKeyring.load(
    env.FIELD_ENCRYPTION_DATA_KEYS ?? '',
    env.FIELD_ENCRYPTION_ACTIVE_KEY_ID ?? '',
    createKeyWrapper(env),
  );
  useFieldKeyring(loaded);
  return loaded;
}

function activeKeyring(): FieldKeyring {
  if (!keyring) throw new Error('Field encryption keyring has not been loaded');
  return keyring;
}

export const encryptedColumn: ValueTransformer = {
  to: (value?: string | null) =>
    value === null || value === undefined ? value : activeKeyring().encrypt(value),
  from: (value?: string | null) =>
    value === null || value === undefined ? value : activeKeyring().decrypt(value),
};
