export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    name: process.env.DB_NAME,
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    queuePrefix: process.env.QUEUE_PREFIX ?? 'bull',
    keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'merchant:',
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    accessTtlSeconds: parseInt(process.env.JWT_ACCESS_TTL_SECONDS ?? '900', 10),
    refreshTtlDays: parseInt(process.env.REFRESH_TOKEN_TTL_DAYS ?? '7', 10),
  },
  loginThrottle: {
    limit: parseInt(process.env.LOGIN_RATE_LIMIT ?? '5', 10),
    ttlMs: parseInt(process.env.LOGIN_RATE_WINDOW_MS ?? '60000', 10),
  },
  outbox: {
    pollMs: parseInt(process.env.OUTBOX_POLL_MS ?? '1000', 10),
    retryBaseMs: parseInt(process.env.OUTBOX_RETRY_BASE_MS ?? '1000', 10),
  },
  riskReview: {
    failureRate: parseFloat(process.env.RISK_PROVIDER_FAILURE_RATE ?? '0'),
    latencyMs: parseInt(process.env.RISK_PROVIDER_LATENCY_MS ?? '0', 10),
    attempts: parseInt(process.env.RISK_JOB_ATTEMPTS ?? '4', 10),
    backoffMs: parseInt(process.env.RISK_JOB_BACKOFF_MS ?? '2000', 10),
  },
});
