import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../users/role.enum';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  const contextFor = (role?: Role) =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ user: role ? { id: 'u1', role } : undefined }) }),
    }) as unknown as ExecutionContext;

  afterEach(() => jest.restoreAllMocks());

  it('allows any authenticated user when no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(contextFor(Role.SALES))).toBe(true);
  });

  it('allows users with a required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN, Role.SALES]);
    expect(guard.canActivate(contextFor(Role.SALES))).toBe(true);
  });

  it('rejects users without a required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
    expect(() => guard.canActivate(contextFor(Role.REVIEWER))).toThrow(ForbiddenException);
  });

  it('rejects requests without a user', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
    expect(() => guard.canActivate(contextFor())).toThrow(ForbiddenException);
  });
});
