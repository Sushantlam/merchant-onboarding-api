import { randomBytes } from 'crypto';
import { config } from 'dotenv';
import { createKeyWrapper, LocalKeyWrapper } from '../common/crypto/key-wrapper';

config();

async function main() {
  const keyId = process.argv[2] ?? `k${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  const masterKey = process.env.FIELD_ENCRYPTION_MASTER_KEY ? undefined : randomBytes(32);
  const wrapper = masterKey ? new LocalKeyWrapper(masterKey) : createKeyWrapper(process.env);
  const wrapped = await wrapper.wrap(randomBytes(32));
  const existing = masterKey ? undefined : process.env.FIELD_ENCRYPTION_DATA_KEYS;

  if (masterKey) console.log(`FIELD_ENCRYPTION_MASTER_KEY=${masterKey.toString('base64')}`);
  console.log(`FIELD_ENCRYPTION_DATA_KEYS=${existing ? `${existing},` : ''}${keyId}:${wrapped}`);
  console.log(`FIELD_ENCRYPTION_ACTIVE_KEY_ID=${keyId}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
