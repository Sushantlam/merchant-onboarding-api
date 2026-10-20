import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { MerchantApplication } from '../applications/merchant-application.entity';
import { ApplicationStatus, RiskStatus } from '../applications/domain/application-status.enum';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-action.enum';
import { RiskCheck } from './risk-check.entity';
import { RISK_PROVIDER, RiskAssessment, RiskProvider } from './provider/risk-provider';
import { RiskReviewJobData } from './risk-review.constants';

export type RiskReviewOutcome = 'COMPLETED' | 'SKIPPED';

@Injectable()
export class RiskReviewService {
  private readonly logger = new Logger(RiskReviewService.name);

  constructor(
    @InjectRepository(MerchantApplication)
    private readonly applications: Repository<MerchantApplication>,
    @Inject(RISK_PROVIDER) private readonly provider: RiskProvider,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  async process(job: RiskReviewJobData, attempt: number): Promise<RiskReviewOutcome> {
    const application = await this.applications.findOne({ where: { id: job.applicationId } });

    if (!application || !this.isAwaitingReview(application, job)) {
      this.logger.log(`Skipping stale risk job for application ${job.applicationId}`);
      return 'SKIPPED';
    }

    const assessment = await this.provider.assess({
      idempotencyKey: `${application.id}:${job.submissionNumber}`,
      legalBusinessName: application.legalBusinessName,
      taxId: application.taxId,
      merchantCategoryCode: application.merchantCategoryCode,
      monthlyVolume: application.monthlyVolume,
      averageTicket: application.averageTicket,
    });

    return this.persistResult(job, assessment, attempt);
  }

  async markFailed(job: RiskReviewJobData, reason: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(MerchantApplication)
        .set({ riskStatus: RiskStatus.FAILED })
        .where('id = :id', { id: job.applicationId })
        .andWhere('status = :status', { status: ApplicationStatus.SUBMITTED })
        .andWhere('submission_count = :submission', { submission: job.submissionNumber })
        .execute();

      if (!result.affected) return;

      await this.audit.record(
        {
          action: AuditAction.RISK_REVIEW_FAILED,
          entityType: 'MerchantApplication',
          entityId: job.applicationId,
          actorId: null,
          metadata: { submissionNumber: job.submissionNumber, reason },
        },
        manager,
      );
    });
  }

  private async persistResult(
    job: RiskReviewJobData,
    assessment: RiskAssessment,
    attempt: number,
  ): Promise<RiskReviewOutcome> {
    return this.dataSource.transaction(async (manager) => {
      const inserted = await manager
        .createQueryBuilder()
        .insert()
        .into(RiskCheck)
        .values({
          applicationId: job.applicationId,
          submissionNumber: job.submissionNumber,
          providerReference: assessment.providerReference,
          score: assessment.score,
          outcome: RiskStatus[assessment.level],
          reasons: assessment.reasons,
          attempts: attempt,
        })
        .orIgnore()
        .returning('id')
        .execute();

      if (!inserted.raw.length) return 'SKIPPED';

      const updated = await manager
        .createQueryBuilder()
        .update(MerchantApplication)
        .set({
          status: ApplicationStatus.UNDER_REVIEW,
          riskStatus: RiskStatus[assessment.level],
          riskScore: assessment.score,
        })
        .where('id = :id', { id: job.applicationId })
        .andWhere('status = :status', { status: ApplicationStatus.SUBMITTED })
        .andWhere('submission_count = :submission', { submission: job.submissionNumber })
        .execute();

      if (!updated.affected) return 'SKIPPED';

      await this.audit.record(
        {
          action: AuditAction.RISK_REVIEW_COMPLETED,
          entityType: 'MerchantApplication',
          entityId: job.applicationId,
          actorId: null,
          metadata: {
            submissionNumber: job.submissionNumber,
            score: assessment.score,
            level: assessment.level,
            reasons: assessment.reasons,
            providerReference: assessment.providerReference,
          },
        },
        manager,
      );

      return 'COMPLETED';
    });
  }

  private isAwaitingReview(application: MerchantApplication, job: RiskReviewJobData): boolean {
    return (
      application.status === ApplicationStatus.SUBMITTED &&
      application.submissionCount === job.submissionNumber
    );
  }
}
