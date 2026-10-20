import { randomBytes } from 'crypto';
import { config } from 'dotenv';
import { seal } from '../src/common/crypto/aes-gcm';

config();

const masterKey = randomBytes(32);

process.env.DB_HOST ??= 'localhost';
process.env.DB_USER ??= 'merchant';
process.env.DB_NAME = process.env.DB_TEST_NAME ?? 'merchant_onboarding_test';
process.env.REDIS_HOST ??= 'localhost';
process.env.QUEUE_PREFIX = 'test';
process.env.REDIS_KEY_PREFIX = 'test-app:';
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.FIELD_ENCRYPTION_MASTER_KEY = masterKey.toString('base64');
process.env.FIELD_ENCRYPTION_DATA_KEYS = `test:${seal(masterKey, randomBytes(32))}`;
process.env.FIELD_ENCRYPTION_ACTIVE_KEY_ID = 'test';
process.env.OUTBOX_POLL_MS = '100';
process.env.OUTBOX_RETRY_BASE_MS = '100';
process.env.LOGIN_RATE_LIMIT = '5';
process.env.RISK_PROVIDER_LATENCY_MS = '0';
process.env.RISK_PROVIDER_FAILURE_RATE = '0';
process.env.RISK_JOB_ATTEMPTS = '3';
process.env.RISK_JOB_BACKOFF_MS = '50';
