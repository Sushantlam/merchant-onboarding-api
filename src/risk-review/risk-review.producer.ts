import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  RISK_REVIEW_JOB,
  RISK_REVIEW_QUEUE,
  RiskReviewJobData,
  riskReviewJobId,
} from './risk-review.constants';

@Injectable()
export class RiskReviewProducer {
  constructor(
    @InjectQueue(RISK_REVIEW_QUEUE) private readonly queue: Queue<RiskReviewJobData>,
    private readonly config: ConfigService,
  ) {}

  async enqueue(data: RiskReviewJobData): Promise<void> {
    await this.queue.add(RISK_REVIEW_JOB, data, {
      jobId: riskReviewJobId(data),
      attempts: this.config.get<number>('riskReview.attempts', 4),
      backoff: {
        type: 'exponential',
        delay: this.config.get<number>('riskReview.backoffMs', 2000),
      },
      removeOnComplete: { count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    });
  }

  async retry(data: RiskReviewJobData): Promise<void> {
    const job = await this.queue.getJob(riskReviewJobId(data));
    if (job && (await job.isFailed())) {
      await job.retry();
      return;
    }
    await this.enqueue(data);
  }
}
