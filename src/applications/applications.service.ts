import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuthUser } from '../common/auth-user';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-action.enum';
import { AuditLog } from '../audit/audit-log.entity';
import { UsersService } from '../users/users.service';
import { Role } from '../users/role.enum';
import { OutboxService } from '../outbox/outbox.service';
import { OutboxEventType } from '../outbox/outbox-event.entity';
import { MerchantApplication } from './merchant-application.entity';
import { ApplicationAccessPolicy } from './domain/application-access.policy';
import { ApplicationStateMachine } from './domain/application-state-machine';
import { ApplicationStatus, ReviewDecision, RiskStatus } from './domain/application-status.enum';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';
import { ListApplicationsQuery } from './dto/list-applications.query';
import { ReviewDecisionDto } from './dto/review-decision.dto';

const ENTITY_TYPE = 'MerchantApplication';

export interface Page<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

@Injectable()
export class ApplicationsService {
  constructor(
    @InjectRepository(MerchantApplication)
    private readonly applications: Repository<MerchantApplication>,
    private readonly dataSource: DataSource,
    private readonly policy: ApplicationAccessPolicy,
    private readonly audit: AuditService,
    private readonly usersService: UsersService,
    private readonly outbox: OutboxService,
  ) {}

  async create(user: AuthUser, dto: CreateApplicationDto): Promise<MerchantApplication> {
    return this.dataSource.transaction(async (manager) => {
      const application = await manager.save(
        manager.create(MerchantApplication, { ...dto, createdById: user.id }),
      );
      await this.audit.record(
        {
          action: AuditAction.APPLICATION_CREATED,
          entityType: ENTITY_TYPE,
          entityId: application.id,
          actorId: user.id,
          metadata: { businessName: application.businessName },
        },
        manager,
      );
      return application;
    });
  }

  async findOne(user: AuthUser, id: string): Promise<MerchantApplication> {
    const application = await this.applications.findOne({ where: { id } });
    if (!application || !this.policy.canView(user, application)) {
      throw new NotFoundException('Application not found');
    }
    return application;
  }

  async list(user: AuthUser, query: ListApplicationsQuery): Promise<Page<MerchantApplication>> {
    const { page, limit, status } = query;
    const [data, total] = await this.applications.findAndCount({
      where: { ...this.policy.scopeFor(user), ...(status && { status }) },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateApplicationDto,
  ): Promise<MerchantApplication> {
    return this.withLockedApplication(user, id, async (application, manager) => {
      this.assertCanEdit(user, application);

      const changedFields = Object.keys(dto).filter(
        (key) => dto[key as keyof UpdateApplicationDto] !== undefined,
      );
      manager.merge(MerchantApplication, application, dto);
      const saved = await manager.save(application);

      await this.audit.record(
        {
          action: AuditAction.APPLICATION_UPDATED,
          entityType: ENTITY_TYPE,
          entityId: id,
          actorId: user.id,
          metadata: { changedFields },
        },
        manager,
      );
      return saved;
    });
  }

  async submit(user: AuthUser, id: string): Promise<MerchantApplication> {
    return this.withLockedApplication(user, id, async (app, manager) => {
      this.assertCanEdit(user, app);
      ApplicationStateMachine.assertTransition(app.status, ApplicationStatus.SUBMITTED);

      app.status = ApplicationStatus.SUBMITTED;
      app.riskStatus = RiskStatus.PENDING;
      app.riskScore = null;
      app.submissionCount += 1;
      app.submittedAt = new Date();
      const saved = await manager.save(app);

      await this.audit.record(
        {
          action: AuditAction.APPLICATION_SUBMITTED,
          entityType: ENTITY_TYPE,
          entityId: id,
          actorId: user.id,
          metadata: { submissionNumber: saved.submissionCount },
        },
        manager,
      );
      await this.outbox.add(manager, OutboxEventType.RISK_REVIEW_REQUESTED, {
        applicationId: saved.id,
        submissionNumber: saved.submissionCount,
      });
      return saved;
    });
  }

  async assignReviewer(
    user: AuthUser,
    id: string,
    reviewerId: string,
  ): Promise<MerchantApplication> {
    if (!this.policy.canAssign(user)) {
      throw new ForbiddenException('Only admins can assign reviewers');
    }

    const reviewer = await this.usersService.findById(reviewerId);
    if (!reviewer || reviewer.role !== Role.REVIEWER || !reviewer.isActive) {
      throw new BadRequestException('reviewerId must reference an active reviewer');
    }

    return this.withLockedApplication(user, id, async (application, manager) => {
      if (!ApplicationStateMachine.isAssignable(application.status)) {
        throw new ConflictException(
          `Applications in ${application.status} status cannot be assigned`,
        );
      }

      const previousReviewerId = application.assignedReviewerId;
      application.assignedReviewerId = reviewer.id;
      const saved = await manager.save(application);

      await this.audit.record(
        {
          action: AuditAction.REVIEWER_ASSIGNED,
          entityType: ENTITY_TYPE,
          entityId: id,
          actorId: user.id,
          metadata: { reviewerId: reviewer.id, previousReviewerId },
        },
        manager,
      );
      return saved;
    });
  }

  async decide(user: AuthUser, id: string, dto: ReviewDecisionDto): Promise<MerchantApplication> {
    return this.withLockedApplication(user, id, async (application, manager) => {
      if (!this.policy.canDecide(user, application)) {
        throw new ForbiddenException('Only the assigned reviewer can record a decision');
      }

      const target = ApplicationStateMachine.targetFor(dto.decision);
      ApplicationStateMachine.assertTransition(application.status, target);
      this.assertDecisionNote(application, dto);

      const previousStatus = application.status;
      application.status = target;
      application.decisionNote = dto.note ?? null;
      application.decidedAt = target === ApplicationStatus.INFO_REQUESTED ? null : new Date();
      const saved = await manager.save(application);

      await this.audit.record(
        {
          action: AuditAction.REVIEW_DECISION_RECORDED,
          entityType: ENTITY_TYPE,
          entityId: id,
          actorId: user.id,
          metadata: {
            decision: dto.decision,
            previousStatus,
            newStatus: target,
            riskStatus: application.riskStatus,
          },
        },
        manager,
      );
      return saved;
    });
  }

  async retryRiskReview(user: AuthUser, id: string): Promise<MerchantApplication> {
    if (!this.policy.canRetryRiskReview(user)) {
      throw new ForbiddenException('Only admins can retry risk reviews');
    }

    return this.withLockedApplication(user, id, async (app, manager) => {
      const retryable =
        app.status === ApplicationStatus.SUBMITTED &&
        [RiskStatus.FAILED, RiskStatus.PENDING].includes(app.riskStatus);
      if (!retryable) {
        throw new ConflictException('Risk review can only be retried for pending or failed checks');
      }

      app.riskStatus = RiskStatus.PENDING;
      const saved = await manager.save(app);
      await this.audit.record(
        {
          action: AuditAction.RISK_REVIEW_RETRIED,
          entityType: ENTITY_TYPE,
          entityId: id,
          actorId: user.id,
          metadata: { submissionNumber: saved.submissionCount },
        },
        manager,
      );
      await this.outbox.add(manager, OutboxEventType.RISK_REVIEW_RETRY_REQUESTED, {
        applicationId: saved.id,
        submissionNumber: saved.submissionCount,
      });
      return saved;
    });
  }

  async auditTrail(user: AuthUser, id: string): Promise<AuditLog[]> {
    await this.findOne(user, id);
    return this.audit.findForEntity(ENTITY_TYPE, id);
  }

  private async withLockedApplication<T>(
    user: AuthUser,
    id: string,
    work: (application: MerchantApplication, manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      const application = await manager.findOne(MerchantApplication, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!application || !this.policy.canView(user, application)) {
        throw new NotFoundException('Application not found');
      }
      return work(application, manager);
    });
  }

  private assertCanEdit(user: AuthUser, application: MerchantApplication): void {
    if (!this.policy.canEdit(user, application)) {
      throw new ForbiddenException('You cannot modify this application');
    }
    if (!ApplicationStateMachine.isEditable(application.status)) {
      throw new ConflictException(
        `Applications in ${application.status} status can no longer be edited`,
      );
    }
  }

  private assertDecisionNote(application: MerchantApplication, dto: ReviewDecisionDto): void {
    const needsNote =
      dto.decision !== ReviewDecision.APPROVE || application.riskStatus === RiskStatus.HIGH;
    if (needsNote && !dto.note) {
      throw new BadRequestException(
        dto.decision === ReviewDecision.APPROVE
          ? 'Approving a high risk application requires a justification note'
          : 'A note is required when rejecting or requesting more information',
      );
    }
  }
}
