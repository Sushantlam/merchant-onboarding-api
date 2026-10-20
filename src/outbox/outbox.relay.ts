import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { RiskReviewProducer } from '../risk-review/risk-review.producer';
import { RiskReviewJobData } from '../risk-review/risk-review.constants';
import { OutboxEvent, OutboxEventType } from './outbox-event.entity';

const BATCH_SIZE = 50;
const MAX_BACKOFF_MS = 60_000;

@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;

  constructor(
    private readonly dataSource: DataSource,
    private readonly riskReviewProducer: RiskReviewProducer,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    const interval = this.config.get<number>('outbox.pollMs', 1000);
    this.timer = setInterval(() => void this.tick(), interval);
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  tick(): Promise<void> {
    this.inFlight ??= this.relayBatch()
      .then(() => undefined)
      .catch((error) => {
        this.logger.error('Outbox relay failed', error instanceof Error ? error.stack : undefined);
      })
      .finally(() => {
        this.inFlight = undefined;
      });
    return this.inFlight;
  }

  async relayBatch(): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const events = await manager
        .createQueryBuilder(OutboxEvent, 'event')
        .where('event.processedAt IS NULL')
        .andWhere('event.availableAt <= now()')
        .orderBy('event.createdAt', 'ASC')
        .limit(BATCH_SIZE)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();

      for (const event of events) {
        await this.deliver(manager, event);
      }
      return events.length;
    });
  }

  private async deliver(manager: EntityManager, event: OutboxEvent): Promise<void> {
    try {
      await this.dispatch(event);
      await manager.update(OutboxEvent, event.id, { processedAt: new Date(), lastError: null });
    } catch (error) {
      const attempts = event.attempts + 1;
      const delay = Math.min(
        this.config.get<number>('outbox.retryBaseMs', 1000) * 2 ** (attempts - 1),
        MAX_BACKOFF_MS,
      );
      await manager.update(OutboxEvent, event.id, {
        attempts,
        lastError: error instanceof Error ? error.message : String(error),
        availableAt: new Date(Date.now() + delay),
      });
      this.logger.warn(
        `Outbox event ${event.id} failed (attempt ${attempts}), retrying in ${delay}ms`,
      );
    }
  }

  private dispatch(event: OutboxEvent): Promise<void> {
    const data = event.payload as unknown as RiskReviewJobData;
    switch (event.type) {
      case OutboxEventType.RISK_REVIEW_REQUESTED:
        return this.riskReviewProducer.enqueue(data);
      case OutboxEventType.RISK_REVIEW_RETRY_REQUESTED:
        return this.riskReviewProducer.retry(data);
    }
  }
}
