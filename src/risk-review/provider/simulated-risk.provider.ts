import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  RiskAssessment,
  RiskAssessmentRequest,
  RiskLevel,
  RiskProvider,
  RiskProviderUnavailableError,
} from './risk-provider';

const HIGH_RISK_MCCS = new Set(['5967', '5993', '6051', '7995']);

@Injectable()
export class SimulatedRiskProvider implements RiskProvider {
  constructor(private readonly config: ConfigService) {}

  async assess(request: RiskAssessmentRequest): Promise<RiskAssessment> {
    await this.delay(this.config.get<number>('riskReview.latencyMs', 0));

    if (Math.random() < this.config.get<number>('riskReview.failureRate', 0)) {
      throw new RiskProviderUnavailableError();
    }

    const reasons: string[] = [];
    let score = this.baseScore(request.taxId);

    if (HIGH_RISK_MCCS.has(request.merchantCategoryCode)) {
      score += 40;
      reasons.push('HIGH_RISK_MCC');
    }
    if (request.monthlyVolume > 1_000_000) {
      score += 20;
      reasons.push('HIGH_MONTHLY_VOLUME');
    }
    if (request.averageTicket > 5_000) {
      score += 15;
      reasons.push('HIGH_AVERAGE_TICKET');
    }

    score = Math.min(score, 100);

    return {
      providerReference: `sim_${this.hash(request.idempotencyKey).slice(0, 16)}`,
      score,
      level: this.levelFor(score),
      reasons,
    };
  }

  private baseScore(taxId: string): number {
    return parseInt(this.hash(taxId).slice(0, 4), 16) % 30;
  }

  private levelFor(score: number): RiskLevel {
    if (score >= 70) return 'HIGH';
    if (score >= 40) return 'MEDIUM';
    return 'LOW';
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private delay(ms: number): Promise<void> {
    return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
  }
}
