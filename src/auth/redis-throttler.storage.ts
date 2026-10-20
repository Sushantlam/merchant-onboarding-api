import { ServiceUnavailableException } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
local blocked = redis.call('PTTL', KEYS[2])
if blocked <= 0 and hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  blocked = tonumber(ARGV[3])
end
return { hits, ttl, blocked }
`;

export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitsKey = `throttle:${throttlerName}:${key}`;
    let result: [number, number, number];
    try {
      result = (await this.redis.eval(
        INCREMENT_SCRIPT,
        2,
        hitsKey,
        `${hitsKey}:blocked`,
        ttl,
        limit,
        blockDuration,
      )) as [number, number, number];
    } catch {
      throw new ServiceUnavailableException('Rate limiter unavailable');
    }

    const [totalHits, hitsTtlMs, blockTtlMs] = result;
    return {
      totalHits,
      timeToExpire: Math.ceil(Math.max(hitsTtlMs, 0) / 1000),
      isBlocked: blockTtlMs > 0,
      timeToBlockExpire: Math.ceil(Math.max(blockTtlMs, 0) / 1000),
    };
  }
}
