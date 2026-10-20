import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '../../users/role.enum';
import { SessionRevocationStore } from '../../auth/session-revocation.store';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const jwtService = new JwtService({ secret: 'test-secret-that-is-long-enough-123456' });
  let revoked: { isRevoked: jest.Mock };
  let reflector: Reflector;
  let guard: JwtAuthGuard;

  const contextWith = (authorization?: string) => {
    const request: { headers: Record<string, string | undefined>; user?: unknown } = {
      headers: { authorization },
    };
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  const tokenFor = (claims: Record<string, unknown>) =>
    `Bearer ${jwtService.sign({ sub: 'user-1', email: 'u@example.com', role: Role.SALES, ...claims })}`;

  beforeEach(() => {
    revoked = { isRevoked: jest.fn().mockResolvedValue(false) };
    reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    guard = new JwtAuthGuard(jwtService, reflector, revoked as unknown as SessionRevocationStore);
  });

  it('attaches the user for a valid token with a live session', async () => {
    const { context, request } = contextWith(tokenFor({ sid: 'session-1' }));

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'user-1', email: 'u@example.com', role: Role.SALES });
    expect(revoked.isRevoked).toHaveBeenCalledWith('session-1');
  });

  it('rejects a token whose session was revoked', async () => {
    revoked.isRevoked.mockResolvedValue(true);
    const { context } = contextWith(tokenFor({ sid: 'session-1' }));

    await expect(guard.canActivate(context)).rejects.toThrow('Session has ended');
  });

  it('rejects tokens without a session id', async () => {
    const { context } = contextWith(tokenFor({}));
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects missing and malformed tokens', async () => {
    await expect(guard.canActivate(contextWith().context)).rejects.toThrow('Missing bearer token');
    await expect(guard.canActivate(contextWith('Bearer nope').context)).rejects.toThrow(
      'Invalid or expired token',
    );
  });

  it('lets public routes through without a token', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    await expect(guard.canActivate(contextWith().context)).resolves.toBe(true);
  });
});
