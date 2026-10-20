import Redis from 'ioredis';
import { RedisThrottlerStorage } from '../src/auth/redis-throttler.storage';
import { clearRedisKeys } from './test-app';

describe('RedisThrottlerStorage (e2e)', () => {
  const prefix = 'test-throttle:';
  let instanceA: Redis;
  let instanceB: Redis;

  beforeAll(async () => {
    await clearRedisKeys(`${prefix}*`);
    const options = { host: process.env.REDIS_HOST, keyPrefix: prefix };
    instanceA = new Redis(options);
    instanceB = new Redis(options);
  });

  afterAll(async () => {
    await clearRedisKeys(`${prefix}*`);
    await Promise.all([instanceA.quit(), instanceB.quit()]);
  });

  it('shares the hit count between API instances', async () => {
    const a = new RedisThrottlerStorage(instanceA);
    const b = new RedisThrottlerStorage(instanceB);

    await a.increment('shared', 60_000, 3, 60_000, 'default');
    await b.increment('shared', 60_000, 3, 60_000, 'default');
    const third = await a.increment('shared', 60_000, 3, 60_000, 'default');
    const fourth = await b.increment('shared', 60_000, 3, 60_000, 'default');

    expect(third).toMatchObject({ totalHits: 3, isBlocked: false });
    expect(fourth).toMatchObject({ totalHits: 4, isBlocked: true });
    expect(fourth.timeToBlockExpire).toBeGreaterThan(55);
  });

  it('starts a fresh window once the ttl has passed', async () => {
    const storage = new RedisThrottlerStorage(instanceA);

    await storage.increment('short', 200, 1, 200, 'default');
    const blocked = await storage.increment('short', 200, 1, 200, 'default');
    expect(blocked.isBlocked).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 300));
    const fresh = await storage.increment('short', 200, 1, 200, 'default');
    expect(fresh).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('keeps separate counters per key and per throttler', async () => {
    const storage = new RedisThrottlerStorage(instanceA);

    await storage.increment('ip-1', 60_000, 5, 60_000, 'default');
    const other = await storage.increment('ip-2', 60_000, 5, 60_000, 'default');
    const otherThrottler = await storage.increment('ip-1', 60_000, 5, 60_000, 'burst');

    expect(other.totalHits).toBe(1);
    expect(otherThrottler.totalHits).toBe(1);
  });
});
