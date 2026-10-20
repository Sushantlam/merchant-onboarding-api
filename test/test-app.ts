import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { WorkerModule } from '../src/worker.module';
import { configureApp } from '../src/app.setup';
import { UsersService } from '../src/users/users.service';
import { Role } from '../src/users/role.enum';
import {
  RISK_PROVIDER,
  RiskAssessmentRequest,
  RiskProvider,
} from '../src/risk-review/provider/risk-provider';
import { RISK_REVIEW_QUEUE } from '../src/risk-review/risk-review.constants';
import { SimulatedRiskProvider } from '../src/risk-review/provider/simulated-risk.provider';

export const TEST_PASSWORD = 'integration-test-password';

export interface TestUser {
  id: string;
  token: string;
  refreshToken: string;
}

export interface TestUsers {
  admin: TestUser;
  reviewer: TestUser;
  otherReviewer: TestUser;
  sales: TestUser;
  otherSales: TestUser;
}

export class ControllableRiskProvider implements RiskProvider {
  failuresRemaining = 0;
  calls = 0;

  constructor(private readonly delegate: RiskProvider) {}

  async assess(input: RiskAssessmentRequest) {
    this.calls += 1;
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error('Simulated provider outage');
    }
    return this.delegate.assess(input);
  }
}

export interface TestContext {
  app: INestApplication;
  dataSource: DataSource;
  queue: Queue;
  riskProvider: ControllableRiskProvider;
  users: TestUsers;
  http: () => ReturnType<typeof request>;
}

export async function createTestApp(): Promise<TestContext> {
  Logger.overrideLogger(['error']);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule, WorkerModule] })
    .overrideProvider(RISK_PROVIDER)
    .useValue(
      new ControllableRiskProvider(
        new SimulatedRiskProvider(
          new ConfigService({ riskReview: { failureRate: 0, latencyMs: 0 } }),
        ),
      ),
    )
    .compile();

  await clearRedisKeys(`${process.env.REDIS_KEY_PREFIX}*`);

  const dataSource = moduleRef.get(DataSource);
  await dataSource.runMigrations();
  await dataSource.query(
    'TRUNCATE outbox_events, refresh_tokens, audit_logs, risk_checks, merchant_applications, users CASCADE',
  );

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  const queue = app.get<Queue>(getQueueToken(RISK_REVIEW_QUEUE));
  await queue.obliterate({ force: true });

  const http = () => request(app.getHttpServer());
  const users = await createUsers(app, http);

  return {
    app,
    dataSource,
    queue,
    riskProvider: app.get(RISK_PROVIDER),
    users,
    http,
  };
}

export async function clearRedisKeys(pattern: string): Promise<void> {
  const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT ?? 6379),
  });
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      if (keys.length) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  } finally {
    await redis.quit();
  }
}

async function createUsers(
  app: INestApplication,
  http: () => ReturnType<typeof request>,
): Promise<TestUsers> {
  const usersService = app.get(UsersService);
  const make = async (email: string, role: Role): Promise<TestUser> => {
    const user = await usersService.create({
      email,
      fullName: email,
      role,
      password: TEST_PASSWORD,
    });
    const res = await http()
      .post('/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    return { id: user.id, token: res.body.accessToken, refreshToken: res.body.refreshToken };
  };

  const [admin, reviewer, otherReviewer, sales, otherSales] = await Promise.all([
    make('admin@example.com', Role.ADMIN),
    make('reviewer@example.com', Role.REVIEWER),
    make('reviewer2@example.com', Role.REVIEWER),
    make('sales@example.com', Role.SALES),
    make('sales2@example.com', Role.SALES),
  ]);
  return { admin, reviewer, otherReviewer, sales, otherSales };
}

export function applicationPayload(overrides: Record<string, unknown> = {}) {
  return {
    businessName: 'Corner Cafe',
    legalBusinessName: 'Corner Cafe Trading Ltd',
    businessType: 'LLC',
    taxId: '12-3456789',
    ownerName: 'Test Owner',
    ownerEmail: 'owner@example.com',
    ownerPhone: '+44 20 7946 0000',
    monthlyVolume: 25000,
    averageTicket: 12.5,
    merchantCategoryCode: '5812',
    ...overrides,
  };
}

export async function waitFor<T>(
  check: () => Promise<T | undefined>,
  timeoutMs = 10000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result !== undefined) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for condition');
}

export function auth(user: TestUser) {
  return { Authorization: `Bearer ${user.token}` };
}

export async function createApplication(ctx: TestContext, owner: TestUser, overrides = {}) {
  const res = await ctx
    .http()
    .post('/applications')
    .set(auth(owner))
    .send(applicationPayload(overrides))
    .expect(201);
  return res.body.id as string;
}

export async function waitForStatus(ctx: TestContext, id: string, status: string) {
  return waitFor(async () => {
    const res = await ctx.http().get(`/applications/${id}`).set(auth(ctx.users.admin));
    return res.body.status === status ? res.body : undefined;
  });
}

export async function createReviewableApplication(ctx: TestContext, overrides = {}) {
  const id = await createApplication(ctx, ctx.users.sales, overrides);
  await ctx.http().post(`/applications/${id}/submit`).set(auth(ctx.users.sales)).expect(202);
  await waitForStatus(ctx, id, 'UNDER_REVIEW');
  await ctx
    .http()
    .post(`/applications/${id}/assign`)
    .set(auth(ctx.users.admin))
    .send({ reviewerId: ctx.users.reviewer.id })
    .expect(200);
  return id;
}
