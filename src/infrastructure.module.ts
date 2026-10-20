import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { entities, migrations } from './database/data-source';
import { loadFieldKeyring } from './common/crypto/field-encryption';

export const FIELD_KEYRING = Symbol('FIELD_KEYRING');

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate: validateEnv }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('database.host'),
        port: config.get('database.port'),
        username: config.get('database.username'),
        password: config.get('database.password'),
        database: config.get('database.name'),
        entities,
        migrations,
        synchronize: false,
      }),
    }),
  ],
  providers: [{ provide: FIELD_KEYRING, useFactory: () => loadFieldKeyring() }],
  exports: [FIELD_KEYRING],
})
export class InfrastructureModule {}
