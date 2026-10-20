import {
  auth,
  createApplication,
  createReviewableApplication,
  createTestApp,
  TestContext,
  waitForStatus,
} from './test-app';

describe('Merchant application lifecycle (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('runs an application from draft to approval', async () => {
    const { sales, admin, reviewer } = ctx.users;

    const created = await ctx
      .http()
      .post('/applications')
      .set(auth(sales))
      .send({
        businessName: 'Harbour Books',
        legalBusinessName: 'Harbour Books Ltd',
        businessType: 'LLC',
        taxId: '55-1234567',
        ownerName: 'Test Owner',
        ownerEmail: 'books@example.com',
        ownerPhone: '+44 20 7946 0001',
        monthlyVolume: 40000,
        averageTicket: 18,
        merchantCategoryCode: '5942',
      })
      .expect(201);

    expect(created.body).toMatchObject({
      status: 'DRAFT',
      riskStatus: 'NOT_STARTED',
      taxIdMasked: '******4567',
      createdById: sales.id,
    });
    expect(created.body).not.toHaveProperty('taxId');
    const id = created.body.id;

    await ctx
      .http()
      .patch(`/applications/${id}`)
      .set(auth(sales))
      .send({ monthlyVolume: 45000 })
      .expect(200);

    const submitted = await ctx
      .http()
      .post(`/applications/${id}/submit`)
      .set(auth(sales))
      .expect(202);
    expect(submitted.body).toMatchObject({ status: 'SUBMITTED', riskStatus: 'PENDING' });

    const reviewed = await waitForStatus(ctx, id, 'UNDER_REVIEW');
    expect(reviewed.riskStatus).toBe('LOW');
    expect(reviewed.riskScore).toEqual(expect.any(Number));

    await ctx
      .http()
      .post(`/applications/${id}/assign`)
      .set(auth(admin))
      .send({ reviewerId: reviewer.id })
      .expect(200);

    const decided = await ctx
      .http()
      .post(`/applications/${id}/decision`)
      .set(auth(reviewer))
      .send({ decision: 'APPROVE' })
      .expect(200);
    expect(decided.body.status).toBe('APPROVED');
    expect(decided.body.decidedAt).not.toBeNull();

    const audit = await ctx.http().get(`/applications/${id}/audit`).set(auth(admin)).expect(200);
    expect(audit.body.map((entry: { action: string }) => entry.action)).toEqual([
      'APPLICATION_CREATED',
      'APPLICATION_UPDATED',
      'APPLICATION_SUBMITTED',
      'RISK_REVIEW_COMPLETED',
      'REVIEWER_ASSIGNED',
      'REVIEW_DECISION_RECORDED',
    ]);
    expect(JSON.stringify(audit.body)).not.toContain('55-1234567');

    const [raw] = await ctx.dataSource.query(
      'SELECT tax_id, owner_name, owner_email, owner_phone FROM merchant_applications WHERE id = $1',
      [id],
    );
    expect(Object.values(raw).every((value) => String(value).startsWith('v1:test:'))).toBe(true);
    expect(JSON.stringify(raw)).not.toContain('books@example.com');
    expect(JSON.stringify(raw)).not.toContain('55-1234567');
  });

  it('blocks editing once submitted', async () => {
    const id = await createApplication(ctx, ctx.users.sales);
    await ctx.http().post(`/applications/${id}/submit`).set(auth(ctx.users.sales)).expect(202);

    await ctx
      .http()
      .patch(`/applications/${id}`)
      .set(auth(ctx.users.sales))
      .send({ businessName: 'Changed' })
      .expect(409);
  });

  it('blocks submitting twice', async () => {
    const id = await createApplication(ctx, ctx.users.sales);
    await ctx.http().post(`/applications/${id}/submit`).set(auth(ctx.users.sales)).expect(202);
    await ctx.http().post(`/applications/${id}/submit`).set(auth(ctx.users.sales)).expect(409);
  });

  it('blocks assigning a draft', async () => {
    const id = await createApplication(ctx, ctx.users.sales);
    await ctx
      .http()
      .post(`/applications/${id}/assign`)
      .set(auth(ctx.users.admin))
      .send({ reviewerId: ctx.users.reviewer.id })
      .expect(409);
  });

  it('only allows assigning users with the reviewer role', async () => {
    const id = await createReviewableApplication(ctx);
    await ctx
      .http()
      .post(`/applications/${id}/assign`)
      .set(auth(ctx.users.admin))
      .send({ reviewerId: ctx.users.sales.id })
      .expect(400);
  });

  it('blocks a second decision on a decided application', async () => {
    const id = await createReviewableApplication(ctx);
    await ctx
      .http()
      .post(`/applications/${id}/decision`)
      .set(auth(ctx.users.reviewer))
      .send({ decision: 'REJECT', note: 'Business could not be verified' })
      .expect(200);

    await ctx
      .http()
      .post(`/applications/${id}/decision`)
      .set(auth(ctx.users.reviewer))
      .send({ decision: 'APPROVE' })
      .expect(409);
  });

  it('requires a note for rejections', async () => {
    const id = await createReviewableApplication(ctx);
    await ctx
      .http()
      .post(`/applications/${id}/decision`)
      .set(auth(ctx.users.reviewer))
      .send({ decision: 'REJECT' })
      .expect(400);
  });

  it('supports requesting more information and resubmitting', async () => {
    const id = await createReviewableApplication(ctx);

    await ctx
      .http()
      .post(`/applications/${id}/decision`)
      .set(auth(ctx.users.reviewer))
      .send({ decision: 'REQUEST_INFO', note: 'Please confirm the trading address' })
      .expect(200);

    await ctx
      .http()
      .patch(`/applications/${id}`)
      .set(auth(ctx.users.sales))
      .send({ legalBusinessName: 'Corner Cafe Holdings Ltd' })
      .expect(200);

    await ctx.http().post(`/applications/${id}/submit`).set(auth(ctx.users.sales)).expect(202);
    const reviewed = await waitForStatus(ctx, id, 'UNDER_REVIEW');
    expect(reviewed.assignedReviewerId).toBe(ctx.users.reviewer.id);

    const checks = await ctx.dataSource.query(
      'SELECT submission_number FROM risk_checks WHERE application_id = $1 ORDER BY submission_number',
      [id],
    );
    expect(checks).toEqual([{ submission_number: 1 }, { submission_number: 2 }]);
  });

  it('validates the application payload', async () => {
    const res = await ctx
      .http()
      .post('/applications')
      .set(auth(ctx.users.sales))
      .send({ businessName: 'X', merchantCategoryCode: 'abcd', monthlyVolume: -5 })
      .expect(400);

    expect(res.body.message).toEqual(expect.arrayContaining([expect.stringContaining('taxId')]));
  });

  describe('listing', () => {
    it('filters by status and paginates', async () => {
      const res = await ctx
        .http()
        .get('/applications')
        .query({ status: 'DRAFT', page: 1, limit: 2 })
        .set(auth(ctx.users.admin))
        .expect(200);

      expect(res.body.data.length).toBeLessThanOrEqual(2);
      expect(res.body.data.every((a: { status: string }) => a.status === 'DRAFT')).toBe(true);
      expect(res.body.meta).toMatchObject({ page: 1, limit: 2 });
      expect(res.body.meta.totalPages).toBe(Math.ceil(res.body.meta.total / 2));
    });

    it('rejects an unknown status and oversized pages', async () => {
      await ctx
        .http()
        .get('/applications')
        .query({ status: 'PAID' })
        .set(auth(ctx.users.admin))
        .expect(400);
      await ctx
        .http()
        .get('/applications')
        .query({ limit: 1000 })
        .set(auth(ctx.users.admin))
        .expect(400);
    });
  });
});
