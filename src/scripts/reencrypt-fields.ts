import dataSource from '../database/data-source';
import { reencryptApplications } from '../database/reencrypt-applications';
import { loadFieldKeyring } from '../common/crypto/field-encryption';

async function main() {
  const keyring = await loadFieldKeyring();
  await dataSource.initialize();

  const updated = await reencryptApplications(dataSource, keyring);

  console.log(`Re-encrypted ${updated} application(s) with key "${keyring.activeKeyId}"`);
  await dataSource.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
