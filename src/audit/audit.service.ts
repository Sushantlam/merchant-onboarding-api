import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { redact } from '../common/utils/sensitive-data';
import { AuditLog } from './audit-log.entity';
import { AuditAction } from './audit-action.enum';

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId: string;
  actorId: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>) {}

  async record(entry: AuditEntry, manager?: EntityManager): Promise<void> {
    const repository = manager ? manager.getRepository(AuditLog) : this.auditLogs;
    await repository.save(
      repository.create({
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        actorId: entry.actorId,
        metadata: redact(entry.metadata ?? {}),
      }),
    );
  }

  findForEntity(entityType: string, entityId: string): Promise<AuditLog[]> {
    return this.auditLogs.find({
      where: { entityType, entityId },
      order: { createdAt: 'ASC' },
    });
  }
}
