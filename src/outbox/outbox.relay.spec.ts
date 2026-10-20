import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { RiskReviewProducer } from '../risk-review/risk-review.producer';
import { OutboxEvent, OutboxEventType } from './outbox-event.entity';
import { OutboxRelay } from './outbox.relay';

describe('OutboxRelay', () => {
  let events: Partial<OutboxEvent>[];
  let producer: { enqueue: jest.Mock; retry: jest.Mock };
  let manager: { createQueryBuilder: jest.Mock; update: jest.Mock };
  let relay: OutboxRelay;

  const event = (overrides: Partial<OutboxEvent> = {}): Partial<OutboxEvent> => ({
    id: 'event-1',
    type: OutboxEventType.RISK_REVIEW_REQUESTED,
    payload: { applicationId: 'app-1', submissionNumber: 1 },
    attempts: 0,
    ...overrides,
  });

  beforeEach(() => {
    events = [event()];
    producer = { enqueue: jest.fn(), retry: jest.fn() };

    const builder: Record<string, jest.Mock> = {};
    for (const method of ['where', 'andWhere', 'orderBy', 'limit', 'setLock', 'setOnLocked']) {
      builder[method] = jest.fn(() => builder);
    }
    builder.getMany = jest.fn(async () => events);

    manager = { createQueryBuilder: jest.fn(() => builder), update: jest.fn() };
    const dataSource = {
      transaction: jest.fn((work: (m: typeof manager) => unknown) => work(manager)),
    };

    relay = new OutboxRelay(
      dataSource as unknown as DataSource,
      producer as unknown as RiskReviewProducer,
      new ConfigService({ outbox: { pollMs: 1000, retryBaseMs: 1000 } }),
    );
  });

  it('enqueues the job and marks the event processed', async () => {
    await expect(relay.relayBatch()).resolves.toBe(1);

    expect(producer.enqueue).toHaveBeenCalledWith({ applicationId: 'app-1', submissionNumber: 1 });
    expect(manager.update).toHaveBeenCalledWith(OutboxEvent, 'event-1', {
      processedAt: expect.any(Date),
      lastError: null,
    });
  });

  it('routes retry requests to the producer retry', async () => {
    events = [event({ type: OutboxEventType.RISK_REVIEW_RETRY_REQUESTED })];

    await relay.relayBatch();

    expect(producer.retry).toHaveBeenCalled();
    expect(producer.enqueue).not.toHaveBeenCalled();
  });

  it('keeps the event and backs off when the queue is unavailable', async () => {
    events = [event({ attempts: 2 })];
    producer.enqueue.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const before = Date.now();

    await relay.relayBatch();

    const [, , changes] = manager.update.mock.calls[0];
    expect(changes).toMatchObject({ attempts: 3, lastError: 'connect ECONNREFUSED' });
    expect(changes.availableAt.getTime()).toBeGreaterThanOrEqual(before + 4000);
    expect(changes).not.toHaveProperty('processedAt');
  });

  it('caps the backoff at one minute', async () => {
    events = [event({ attempts: 20 })];
    producer.enqueue.mockRejectedValue(new Error('down'));
    const before = Date.now();

    await relay.relayBatch();

    const [, , changes] = manager.update.mock.calls[0];
    expect(changes.availableAt.getTime()).toBeLessThanOrEqual(before + 60_000 + 50);
  });
});
