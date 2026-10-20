import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/auth-user';
import { UsersService } from '../users/users.service';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { AuthService } from './auth.service';
import { AuthThrottlerGuard } from './auth-throttler.guard';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { TokenResponseDto } from './dto/token-response.dto';

const TOKEN_ENDPOINT_LIMIT = { limit: 30, ttl: 60_000 };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Public()
  @UseGuards(AuthThrottlerGuard)
  @ApiTooManyRequestsResponse()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<TokenResponseDto> {
    return this.authService.login(dto.email, dto.password);
  }

  @Public()
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: TOKEN_ENDPOINT_LIMIT })
  @ApiTooManyRequestsResponse()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto): Promise<TokenResponseDto> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: TOKEN_ENDPOINT_LIMIT })
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Body() dto: RefreshTokenDto): Promise<void> {
    return this.authService.logout(dto.refreshToken);
  }

  @ApiBearerAuth()
  @Get('me')
  async me(@CurrentUser() user: AuthUser): Promise<UserResponseDto> {
    const found = await this.usersService.findById(user.id);
    if (!found) throw new NotFoundException('User not found');
    return UserResponseDto.from(found);
  }
}
