import { Body, Controller, Get, ParseEnumPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from './role.enum';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UserResponseDto } from './dto/user-response.dto';

@ApiTags('users')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  async create(@Body() dto: CreateUserDto): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.usersService.create(dto));
  }

  @Get()
  @ApiQuery({ name: 'role', enum: Role, required: false })
  async findAll(
    @Query('role', new ParseEnumPipe(Role, { optional: true })) role?: Role,
  ): Promise<UserResponseDto[]> {
    const users = await this.usersService.findAll(role);
    return users.map(UserResponseDto.from);
  }
}
