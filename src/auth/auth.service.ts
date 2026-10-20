import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
import { IssuedRefreshToken, RefreshTokenService } from './refresh-token.service';
import { TokenResponseDto } from './dto/token-response.dto';

@Injectable()
export class AuthService {
  private readonly dummyHash = bcrypt.hash(randomUUID(), 12);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, password: string): Promise<TokenResponseDto> {
    const user = await this.usersService.findByEmailWithPassword(email);
    const passwordMatches = await bcrypt.compare(
      password,
      user?.passwordHash ?? (await this.dummyHash),
    );

    if (!user || !user.isActive || !passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.tokensFor(user, await this.refreshTokens.issue(user.id));
  }

  async refresh(refreshToken: string): Promise<TokenResponseDto> {
    const rotated = await this.refreshTokens.rotate(refreshToken);
    const user = await this.usersService.findById(rotated.userId);

    if (!user || !user.isActive) {
      await this.refreshTokens.revokeSession(rotated.sessionId);
      throw new UnauthorizedException('Invalid refresh token');
    }
    return this.tokensFor(user, rotated);
  }

  logout(refreshToken: string): Promise<void> {
    return this.refreshTokens.revokeByToken(refreshToken);
  }

  private async tokensFor(user: User, refresh: IssuedRefreshToken): Promise<TokenResponseDto> {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      sid: refresh.sessionId,
    });

    return {
      accessToken,
      refreshToken: refresh.token,
      tokenType: 'Bearer',
      expiresIn: this.config.getOrThrow<number>('jwt.accessTtlSeconds'),
    };
  }
}
