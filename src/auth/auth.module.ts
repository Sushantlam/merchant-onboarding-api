import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import Redis from 'ioredis';
import { UsersModule } from '../users/users.module';
import { REDIS_CLIENT } from '../redis/redis.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { RefreshToken } from './refresh-token.entity';
import { RefreshTokenService } from './refresh-token.service';
import { SessionRevocationStore } from './session-revocation.store';
import { RedisThrottlerStorage } from './redis-throttler.storage';

@Global()
@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([RefreshToken]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('jwt.secret'),
        signOptions: { expiresIn: config.getOrThrow<number>('jwt.accessTtlSeconds') },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: (config: ConfigService, redis: Redis) => ({
        storage: new RedisThrottlerStorage(redis),
        throttlers: [
          {
            limit: config.get<number>('loginThrottle.limit', 5),
            ttl: config.get<number>('loginThrottle.ttlMs', 60000),
          },
        ],
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    RefreshTokenService,
    SessionRevocationStore,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
