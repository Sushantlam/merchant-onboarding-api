import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { RefreshToken } from './refresh-token.entity';
import { SessionRevocationStore } from './session-revocation.store';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface IssuedRefreshToken {
  token: string;
  userId: string;
  sessionId: string;
}

type RotationResult =
  | { outcome: 'rotated'; issued: IssuedRefreshToken }
  | { outcome: 'reused'; sessionId: string }
  | { outcome: 'invalid' };

@Injectable()
export class RefreshTokenService {
  constructor(
    @InjectRepository(RefreshToken) private readonly tokens: Repository<RefreshToken>,
    private readonly dataSource: DataSource,
    private readonly revokedSessions: SessionRevocationStore,
    private readonly config: ConfigService,
  ) {}

  issue(userId: string): Promise<IssuedRefreshToken> {
    return this.create(this.tokens.manager, userId, randomUUID());
  }

  async rotate(token: string): Promise<IssuedRefreshToken> {
    const result = await this.dataSource.transaction(async (manager): Promise<RotationResult> => {
      const current = await manager.findOne(RefreshToken, {
        where: { tokenHash: this.hash(token) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) return { outcome: 'invalid' };

      if (current.revokedAt) {
        await this.revokeFamilyWith(manager, current.familyId);
        return { outcome: 'reused', sessionId: current.familyId };
      }
      if (current.expiresAt <= new Date()) return { outcome: 'invalid' };

      const next = await this.create(manager, current.userId, current.familyId);
      await manager.update(RefreshToken, current.id, {
        revokedAt: new Date(),
        replacedById: next.id,
      });
      return { outcome: 'rotated', issued: next };
    });

    if (result.outcome === 'reused') await this.revokedSessions.revoke(result.sessionId);
    if (result.outcome !== 'rotated') throw new UnauthorizedException('Invalid refresh token');
    return result.issued;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.revokeFamilyWith(this.tokens.manager, sessionId);
    await this.revokedSessions.revoke(sessionId);
  }

  async revokeByToken(token: string): Promise<void> {
    const current = await this.tokens.findOne({ where: { tokenHash: this.hash(token) } });
    if (current) await this.revokeSession(current.familyId);
  }

  private async create(manager: EntityManager, userId: string, familyId: string) {
    const token = randomBytes(48).toString('base64url');
    const ttlDays = this.config.get<number>('jwt.refreshTtlDays', 7);
    const saved = await manager.save(
      manager.create(RefreshToken, {
        userId,
        familyId,
        tokenHash: this.hash(token),
        expiresAt: new Date(Date.now() + ttlDays * DAY_MS),
      }),
    );
    return { id: saved.id, token, userId, sessionId: familyId };
  }

  private async revokeFamilyWith(manager: EntityManager, familyId: string): Promise<void> {
    await manager.update(
      RefreshToken,
      { familyId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
