import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { InfrastructureModule } from './infrastructure.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ApplicationsModule } from './applications/applications.module';
import { AuditModule } from './audit/audit.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    InfrastructureModule,
    RedisModule,
    AuthModule,
    UsersModule,
    AuditModule,
    ApplicationsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
})
export class AppModule {}
