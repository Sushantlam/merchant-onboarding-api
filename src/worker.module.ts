import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { InfrastructureModule } from './infrastructure.module';
import { RiskReviewModule } from './risk-review/risk-review.module';
import { OutboxRelay } from './outbox/outbox.relay';

@Module({
  imports: [
    InfrastructureModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        prefix: config.get('redis.queuePrefix'),
        connection: {
          host: config.get('redis.host'),
          port: config.get('redis.port'),
        },
      }),
    }),
    RiskReviewModule,
  ],
  providers: [OutboxRelay],
})
export class WorkerModule {}
