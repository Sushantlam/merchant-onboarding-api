import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { RISK_REVIEW_QUEUE, RiskReviewJobData } from './risk-review.constants';
import { RiskReviewOutcome, RiskReviewService } from './risk-review.service';

@Processor(RISK_REVIEW_QUEUE)
export class RiskReviewProcessor extends WorkerHost {
  private readonly logger = new Logger(RiskReviewProcessor.name);

  constructor(private readonly riskReviewService: RiskReviewService) {
    super();
  }

  process(job: Job<RiskReviewJobData>): Promise<RiskReviewOutcome> {
    return this.riskReviewService.process(job.data, job.attemptsMade + 1);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<RiskReviewJobData> | undefined, error: Error) {
    if (!job) return;

    const maxAttempts = job.opts.attempts ?? 1;
    this.logger.warn(
      `Risk job ${job.id} failed (attempt ${job.attemptsMade}/${maxAttempts}): ${error.message}`,
    );

    if (job.attemptsMade >= maxAttempts) {
      await this.riskReviewService.markFailed(job.data, error.message);
    }
  }
}
