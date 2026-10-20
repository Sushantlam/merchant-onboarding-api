import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

@Injectable()
export class SessionRevocationStore {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  async revoke(sessionId: string): Promise<void> {
    const ttl = this.config.getOrThrow<number>('jwt.accessTtlSeconds');
    await this.redis.set(this.key(sessionId), '1', 'EX', ttl);
  }

  async isRevoked(sessionId: string): Promise<boolean> {
    try {
      return (await this.redis.exists(this.key(sessionId))) === 1;
    } catch {
      throw new ServiceUnavailableException('Unable to verify session');
    }
  }

  private key(sessionId: string): string {
    return `auth:revoked-session:${sessionId}`;
  }
}
