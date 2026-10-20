import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';
import { User } from '../users/user.entity';
import { MerchantApplication } from '../applications/merchant-application.entity';
import { RiskCheck } from '../risk-review/risk-check.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { RefreshToken } from '../auth/refresh-token.entity';
import { OutboxEvent } from '../outbox/outbox-event.entity';
import { InitialSchema1760000000000 } from './migrations/1760000000000-InitialSchema';
import { SecurityAndOutbox1760500000000 } from './migrations/1760500000000-SecurityAndOutbox';

config();

export const entities = [User, MerchantApplication, RiskCheck, AuditLog, RefreshToken, OutboxEvent];
export const migrations = [InitialSchema1760000000000, SecurityAndOutbox1760500000000];

export function buildDataSourceOptions(env: NodeJS.ProcessEnv = process.env): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: parseInt(env.DB_PORT ?? '5432', 10),
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    entities,
    migrations,
    synchronize: false,
  };
}

export default new DataSource(buildDataSourceOptions());
