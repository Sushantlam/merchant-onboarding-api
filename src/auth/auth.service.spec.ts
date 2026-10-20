import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
import { Role } from '../users/role.enum';
import { AuthService } from './auth.service';
import { RefreshTokenService } from './refresh-token.service';

describe('AuthService', () => {
  let usersService: { findByEmailWithPassword: jest.Mock; findById: jest.Mock };
  let refreshTokens: {
    issue: jest.Mock;
    rotate: jest.Mock;
    revokeSession: jest.Mock;
    revokeByToken: jest.Mock;
  };
  let jwtService: JwtService;
  let service: AuthService;
  let user: User;

  beforeAll(async () => {
    user = {
      id: 'user-1',
      email: 'sales@example.com',
      role: Role.SALES,
      isActive: true,
      passwordHash: await bcrypt.hash('correct-password', 4),
    } as User;
  });

  beforeEach(() => {
    usersService = { findByEmailWithPassword: jest.fn(), findById: jest.fn() };
    refreshTokens = {
      issue: jest
        .fn()
        .mockResolvedValue({ token: 'refresh-1', userId: 'user-1', sessionId: 'session-1' }),
      rotate: jest
        .fn()
        .mockResolvedValue({ token: 'refresh-2', userId: 'user-1', sessionId: 'session-1' }),
      revokeSession: jest.fn(),
      revokeByToken: jest.fn(),
    };
    jwtService = new JwtService({ secret: 'test-secret-that-is-long-enough-123456' });
    service = new AuthService(
      usersService as unknown as UsersService,
      jwtService,
      refreshTokens as unknown as RefreshTokenService,
      new ConfigService({ jwt: { accessTtlSeconds: 900 } }),
    );
  });

  it('issues a token carrying the user id and role', async () => {
    usersService.findByEmailWithPassword.mockResolvedValue(user);

    const result = await service.login(user.email, 'correct-password');
    const payload = jwtService.verify(result.accessToken);

    expect(payload).toMatchObject({ sub: user.id, role: Role.SALES, sid: 'session-1' });
    expect(result.refreshToken).toBe('refresh-1');
    expect(payload).not.toHaveProperty('passwordHash');
  });

  it('rejects a wrong password', async () => {
    usersService.findByEmailWithPassword.mockResolvedValue(user);
    await expect(service.login(user.email, 'wrong-password')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an unknown email with the same error', async () => {
    usersService.findByEmailWithPassword.mockResolvedValue(null);
    await expect(service.login('nobody@example.com', 'whatever')).rejects.toThrow(
      'Invalid email or password',
    );
  });

  it('rejects inactive users', async () => {
    usersService.findByEmailWithPassword.mockResolvedValue({ ...user, isActive: false });
    await expect(service.login(user.email, 'correct-password')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rotates the refresh token and issues a new access token', async () => {
    usersService.findById.mockResolvedValue(user);

    const result = await service.refresh('refresh-1');

    expect(refreshTokens.rotate).toHaveBeenCalledWith('refresh-1');
    expect(result.refreshToken).toBe('refresh-2');
    expect(jwtService.verify(result.accessToken)).toMatchObject({ sub: user.id });
  });

  it('revokes the session when a deactivated user tries to refresh', async () => {
    usersService.findById.mockResolvedValue({ ...user, isActive: false });

    await expect(service.refresh('refresh-1')).rejects.toThrow(UnauthorizedException);
    expect(refreshTokens.revokeSession).toHaveBeenCalledWith('session-1');
  });

  it('ends the session on logout', async () => {
    await service.logout('refresh-1');
    expect(refreshTokens.revokeByToken).toHaveBeenCalledWith('refresh-1');
  });
});
