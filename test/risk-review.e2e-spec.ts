import {
  auth,
  createApplication,
  createTestApp,
  TestContext,
  waitFor,
  waitForStatus,
} from './test-app';
import { RiskReviewService } from '../src/risk-review/risk-review.service';
import { RiskReviewProducer } from '../src/risk-review/risk-review.producer';

describe('Asynchronous risk review (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(() => {
    ctx.riskProvider.failuresRemaining = 0;
    ctx.riskProvider.calls = 0;
  });

  const submit = async (id: string) =>
    ctx.http().post(`/applications/${id}/submit`).set(auth(ctx.users.sales)).expect(202);

  const riskChecksFor = (id: string) =>
    ctx.dataSource.query('SELECT * FROM risk_checks WHERE application_id = $1', [id]);

  it('scores high risk merchants from the simulated provider', async () => {
    const id = await createApplication(ctx, ctx.users.sales, {
      merchantCategoryCode: '7995',
      monthlyVolume: 2_000_000,
      averageTicket: 9000,
    });
    await submit(id);

    const reviewed = await waitForStatus(ctx, id, 'UNDER_REVIEW');
    expect(reviewed.riskStatus).toBe('HIGH');

    const [check] = await riskChecksFor(id);
    expect(check.reasons).toEqual(['HIGH_RISK_MCC', 'HIGH_MONTHLY_VOLUME', 'HIGH_AVERAGE_TICKET']);
  });

  it('retries transient provider failures with backoff', async () => {
    ctx.riskProvider.failuresRemaining = 2;
    const id = await createApplication(ctx, ctx.users.sales);
    await submit(id);

    await waitForStatus(ctx, id, 'UNDER_REVIEW');
    const [check] = await riskChecksFor(id);
    expect(check.attempts).toBe(3);
    expect(ctx.riskProvider.calls).toBe(3);
  });

  it('marks the risk check failed after exhausting retries and lets an admin retry', async () => {
    ctx.riskProvider.failuresRemaining = 3;
    const id = await createApplication(ctx, ctx.users.sales);
    await submit(id);

    const failed = await waitFor(async () => {
      const res = await ctx.http().get(`/applications/${id}`).set(auth(ctx.users.admin));
      return res.body.riskStatus === 'FAILED' ? res.body : undefined;
    });
    expect(failed.status).toBe('SUBMITTED');

    await ctx
      .http()
      .post(`/applications/${id}/risk-review/retry`)
      .set(auth(ctx.users.sales))
      .expect(403);

    await ctx
      .http()
      .post(`/applications/${id}/risk-review/retry`)
      .set(auth(ctx.users.admin))
      .expect(202);

    const reviewed = await waitForStatus(ctx, id, 'UNDER_REVIEW');
    expect(reviewed.riskStatus).not.toBe('FAILED');
    expect(await riskChecksFor(id)).toHaveLength(1);
  });

  it('does not duplicate work when the same job is enqueued twice', async () => {
    const id = await createApplication(ctx, ctx.users.sales);
    await submit(id);
    await ctx.app.get(RiskReviewProducer).enqueue({ applicationId: id, submissionNumber: 1 });

    await waitForStatus(ctx, id, 'UNDER_REVIEW');
    expect(await riskChecksFor(id)).toHaveLength(1);
  });

  it('is idempotent when a completed job is processed again', async () => {
    const id = await createApplication(ctx, ctx.users.sales);
    await submit(id);
    await waitForStatus(ctx, id, 'UNDER_REVIEW');

    const callsBefore = ctx.riskProvider.calls;
    const outcome = await ctx.app
      .get(RiskReviewService)
      .process({ applicationId: id, submissionNumber: 1 }, 1);

    expect(outcome).toBe('SKIPPED');
    expect(ctx.riskProvider.calls).toBe(callsBefore);
    expect(await riskChecksFor(id)).toHaveLength(1);

    const audit = await ctx.http().get(`/applications/${id}/audit`).set(auth(ctx.users.admin));
    const completions = audit.body.filter(
      (entry: { action: string }) => entry.action === 'RISK_REVIEW_COMPLETED',
    );
    expect(completions).toHaveLength(1);
  });

  it('ignores a stale job from an earlier submission', async () => {
    const id = await createApplication(ctx, ctx.users.sales);
    await submit(id);
    await waitForStatus(ctx, id, 'UNDER_REVIEW');

    const outcome = await ctx.app
      .get(RiskReviewService)
      .process({ applicationId: id, submissionNumber: 99 }, 1);
    expect(outcome).toBe('SKIPPED');
  });

  it('keeps the request in the outbox until the queue accepts it', async () => {
    const producer = ctx.app.get(RiskReviewProducer);
    const enqueue = jest
      .spyOn(producer, 'enqueue')
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    const id = await createApplication(ctx, ctx.users.sales);
    await submit(id);

    await waitForStatus(ctx, id, 'UNDER_REVIEW');
    const [event] = await ctx.dataSource.query(
      `SELECT attempts, last_error, processed_at FROM outbox_events WHERE payload->>'applicationId' = $1`,
      [id],
    );
    expect(event.attempts).toBe(1);
    expect(event.processed_at).not.toBeNull();
    expect(event.last_error).toBeNull();
    expect(enqueue).toHaveBeenCalledTimes(2);
    enqueue.mockRestore();
  });

  it('writes the outbox event in the same transaction as the submission', async () => {
    const id = await createApplication(ctx, ctx.users.sales);
    await ctx.http().post(`/applications/${id}/submit`).set(auth(ctx.users.otherSales)).expect(404);

    const events = await ctx.dataSource.query(
      `SELECT id FROM outbox_events WHERE payload->>'applicationId' = $1`,
      [id],
    );
    expect(events).toHaveLength(0);
  });
});
