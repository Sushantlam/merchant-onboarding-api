import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MerchantApplication } from '../applications/merchant-application.entity';
import { AuditModule } from '../audit/audit.module';
import { RiskCheck } from './risk-check.entity';
import { RISK_REVIEW_QUEUE } from './risk-review.constants';
import { RISK_PROVIDER } from './provider/risk-provider';
import { SimulatedRiskProvider } from './provider/simulated-risk.provider';
import { RiskReviewProducer } from './risk-review.producer';
import { RiskReviewService } from './risk-review.service';
import { RiskReviewProcessor } from './risk-review.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([MerchantApplication, RiskCheck]),
    BullModule.registerQueue({ name: RISK_REVIEW_QUEUE }),
    AuditModule,
  ],
  providers: [
    { provide: RISK_PROVIDER, useClass: SimulatedRiskProvider },
    RiskReviewProducer,
    RiskReviewService,
    RiskReviewProcessor,
  ],
  exports: [RiskReviewProducer],
})
export class RiskReviewModule {}
