const required = [
  'DB_HOST',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'JWT_SECRET',
  'FIELD_ENCRYPTION_MASTER_KEY',
  'FIELD_ENCRYPTION_DATA_KEYS',
  'FIELD_ENCRYPTION_ACTIVE_KEY_ID',
];

export function validateEnv(config: Record<string, unknown>) {
  const missing = required.filter((key) => !config[key]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  if (String(config.JWT_SECRET).length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  return config;
}
