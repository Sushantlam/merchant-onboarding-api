import {
  applicationPayload,
  auth,
  createApplication,
  createReviewableApplication,
  createTestApp,
  TestContext,
} from './test-app';

describe('Authorization rules (e2e)', () => {
  let ctx: TestContext;
  let salesApplicationId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    salesApplicationId = await createApplication(ctx, ctx.users.sales);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('SALES object-level isolation', () => {
    it('cannot read another sales user application by id', async () => {
      await ctx
        .http()
        .get(`/applications/${salesApplicationId}`)
        .set(auth(ctx.users.otherSales))
        .expect(404);
    });

    it('cannot update another sales user application by id', async () => {
      await ctx
        .http()
        .patch(`/applications/${salesApplicationId}`)
        .set(auth(ctx.users.otherSales))
        .send({ businessName: 'Hijacked' })
        .expect(404);

      const res = await ctx
        .http()
        .get(`/applications/${salesApplicationId}`)
        .set(auth(ctx.users.sales))
        .expect(200);
      expect(res.body.businessName).toBe('Corner Cafe');
    });

    it('cannot submit another sales user application', async () => {
      await ctx
        .http()
        .post(`/applications/${salesApplicationId}/submit`)
        .set(auth(ctx.users.otherSales))
        .expect(404);
    });

    it('cannot read its audit trail', async () => {
      await ctx
        .http()
        .get(`/applications/${salesApplicationId}/audit`)
        .set(auth(ctx.users.otherSales))
        .expect(403);
    });

    it('only lists applications the user created', async () => {
      await createApplication(ctx, ctx.users.otherSales, { businessName: 'Other Shop' });

      const res = await ctx.http().get('/applications').set(auth(ctx.users.otherSales)).expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].businessName).toBe('Other Shop');
      expect(res.body.data.map((a: { id: string }) => a.id)).not.toContain(salesApplicationId);
    });

    it('cannot claim another user as the creator', async () => {
      await ctx
        .http()
        .post('/applications')
        .set(auth(ctx.users.sales))
        .send({ ...applicationPayload(), createdById: ctx.users.otherSales.id })
        .expect(400);
    });

    it('cannot assign reviewers', async () => {
      await ctx
        .http()
        .post(`/applications/${salesApplicationId}/assign`)
        .set(auth(ctx.users.sales))
        .send({ reviewerId: ctx.users.reviewer.id })
        .expect(403);
    });

    it('cannot record review decisions, even on its own application', async () => {
      await ctx
        .http()
        .post(`/applications/${salesApplicationId}/decision`)
        .set(auth(ctx.users.sales))
        .send({ decision: 'APPROVE' })
        .expect(403);
    });

    it('cannot manage users', async () => {
      await ctx.http().get('/users').set(auth(ctx.users.sales)).expect(403);
    });
  });

  describe('REVIEWER restrictions', () => {
    let reviewableId: string;

    beforeAll(async () => {
      reviewableId = await createReviewableApplication(ctx);
    });

    it('cannot create applications', async () => {
      await ctx
        .http()
        .post('/applications')
        .set(auth(ctx.users.reviewer))
        .send(applicationPayload())
        .expect(403);
    });

    it('cannot see applications that are not assigned to them', async () => {
      await ctx
        .http()
        .get(`/applications/${reviewableId}`)
        .set(auth(ctx.users.otherReviewer))
        .expect(404);
    });

    it('cannot record a decision on an application assigned to someone else', async () => {
      await ctx
        .http()
        .post(`/applications/${reviewableId}/decision`)
        .set(auth(ctx.users.otherReviewer))
        .send({ decision: 'APPROVE' })
        .expect(404);

      const res = await ctx
        .http()
        .get(`/applications/${reviewableId}`)
        .set(auth(ctx.users.admin))
        .expect(200);
      expect(res.body.status).toBe('UNDER_REVIEW');
    });

    it('loses access after being reassigned', async () => {
      await ctx
        .http()
        .post(`/applications/${reviewableId}/assign`)
        .set(auth(ctx.users.admin))
        .send({ reviewerId: ctx.users.otherReviewer.id })
        .expect(200);

      await ctx
        .http()
        .post(`/applications/${reviewableId}/decision`)
        .set(auth(ctx.users.reviewer))
        .send({ decision: 'APPROVE' })
        .expect(404);
    });
  });

  describe('ADMIN restrictions', () => {
    it('cannot record a review decision because it is not the assigned reviewer', async () => {
      const id = await createReviewableApplication(ctx);

      await ctx
        .http()
        .post(`/applications/${id}/decision`)
        .set(auth(ctx.users.admin))
        .send({ decision: 'APPROVE' })
        .expect(403);
    });
  });

  it('rejects malformed ids before touching the database', async () => {
    await ctx.http().get('/applications/not-a-uuid').set(auth(ctx.users.admin)).expect(400);
  });
});
