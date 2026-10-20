import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { OutboxEvent, OutboxEventType } from './outbox-event.entity';

@Injectable()
export class OutboxService {
  async add(
    manager: EntityManager,
    type: OutboxEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const repository = manager.getRepository(OutboxEvent);
    await repository.save(repository.create({ type, payload }));
  }
}
