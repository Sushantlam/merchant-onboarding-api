import { JwtService } from '@nestjs/jwt';
import { createTestApp, TEST_PASSWORD, TestContext } from './test-app';

describe('Authentication (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('issues a bearer token for valid credentials', async () => {
    const res = await ctx
      .http()
      .post('/auth/login')
      .send({ email: 'sales@example.com', password: TEST_PASSWORD })
      .expect(200);

    expect(res.body).toEqual({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      tokenType: 'Bearer',
      expiresIn: 900,
    });
  });

  it('rejects a wrong password without revealing whether the user exists', async () => {
    const wrongPassword = await ctx
      .http()
      .post('/auth/login')
      .send({ email: 'sales@example.com', password: 'not-the-password' })
      .expect(401);
    const unknownUser = await ctx
      .http()
      .post('/auth/login')
      .send({ email: 'ghost@example.com', password: 'not-the-password' })
      .expect(401);

    expect(wrongPassword.body.message).toBe(unknownUser.body.message);
  });

  it('validates the login payload', async () => {
    await ctx.http().post('/auth/login').send({ email: 'not-an-email' }).expect(400);
  });

  it('returns the current user without the password hash', async () => {
    const res = await ctx
      .http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${ctx.users.sales.token}`)
      .expect(200);

    expect(res.body).toMatchObject({ email: 'sales@example.com', role: 'SALES' });
    expect(res.body).not.toHaveProperty('passwordHash');
  });

  it('rejects requests without a token', async () => {
    await ctx.http().get('/applications').expect(401);
  });

  it('rejects a token signed with a different secret', async () => {
    const forged = new JwtService({ secret: 'some-other-secret-value-that-is-long' }).sign({
      sub: ctx.users.sales.id,
      email: 'sales@example.com',
      role: 'ADMIN',
    });

    await ctx.http().get('/applications').set('Authorization', `Bearer ${forged}`).expect(401);
  });

  it('rejects an expired token', async () => {
    const expired = ctx.app
      .get(JwtService)
      .sign(
        { sub: ctx.users.admin.id, email: 'admin@example.com', role: 'ADMIN' },
        { expiresIn: -10 },
      );

    await ctx.http().get('/applications').set('Authorization', `Bearer ${expired}`).expect(401);
  });

  describe('refresh tokens', () => {
    const login = async (email: string) =>
      (await ctx.http().post('/auth/login').send({ email, password: TEST_PASSWORD }).expect(200))
        .body;

    const refresh = (refreshToken: string) =>
      ctx.http().post('/auth/refresh').send({ refreshToken });

    it('rotates the refresh token and returns a working access token', async () => {
      const first = await login('reviewer@example.com');

      const res = await refresh(first.refreshToken).expect(200);

      expect(res.body.refreshToken).not.toBe(first.refreshToken);
      await ctx
        .http()
        .get('/auth/me')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
    });

    it('revokes the whole session when an old refresh token is reused', async () => {
      const first = await login('reviewer2@example.com');
      const second = (await refresh(first.refreshToken).expect(200)).body;

      await refresh(first.refreshToken).expect(401);
      await refresh(second.refreshToken).expect(401);
    });

    it('ends both the refresh token and the access token on logout', async () => {
      const session = await login('admin@example.com');
      const me = () =>
        ctx.http().get('/auth/me').set('Authorization', `Bearer ${session.accessToken}`);
      await me().expect(200);

      await ctx
        .http()
        .post('/auth/logout')
        .send({ refreshToken: session.refreshToken })
        .expect(204);

      await refresh(session.refreshToken).expect(401);
      const res = await me().expect(401);
      expect(res.body.message).toBe('Session has ended');

      await ctx
        .http()
        .get('/auth/me')
        .set('Authorization', `Bearer ${ctx.users.admin.token}`)
        .expect(200);
    });

    it('kills the access token of a session whose refresh token was stolen', async () => {
      const first = await login('sales@example.com');
      const second = (await refresh(first.refreshToken).expect(200)).body;

      await refresh(first.refreshToken).expect(401);

      await ctx
        .http()
        .get('/auth/me')
        .set('Authorization', `Bearer ${second.accessToken}`)
        .expect(401);
    });

    it('rejects unknown refresh tokens', async () => {
      await refresh('x'.repeat(64)).expect(401);
    });

    it('stores only a hash of the refresh token', async () => {
      const rows = await ctx.dataSource.query('SELECT token_hash FROM refresh_tokens');
      const hashes = rows.map((row: { token_hash: string }) => row.token_hash);
      expect(hashes).not.toContain(ctx.users.sales.refreshToken);
      expect(hashes.every((hash: string) => /^[a-f0-9]{64}$/.test(hash))).toBe(true);
    });
  });

  it('rate limits repeated login attempts for the same account', async () => {
    const attempt = () =>
      ctx
        .http()
        .post('/auth/login')
        .send({ email: 'sales2@example.com', password: 'wrong-password-123' });

    for (let i = 0; i < 4; i += 1) {
      await attempt().expect(401);
    }
    const blocked = await attempt().expect(429);
    expect(blocked.body.statusCode).toBe(429);

    await ctx
      .http()
      .post('/auth/login')
      .send({ email: 'reviewer@example.com', password: TEST_PASSWORD })
      .expect(200);
  });
});
