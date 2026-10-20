import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { OutboxModule } from '../outbox/outbox.module';
import { MerchantApplication } from './merchant-application.entity';
import { ApplicationsService } from './applications.service';
import { ApplicationsController } from './applications.controller';
import { ApplicationAccessPolicy } from './domain/application-access.policy';

@Module({
  imports: [
    TypeOrmModule.forFeature([MerchantApplication]),
    UsersModule,
    AuditModule,
    OutboxModule,
  ],
  controllers: [ApplicationsController],
  providers: [ApplicationsService, ApplicationAccessPolicy],
})
export class ApplicationsModule {}
