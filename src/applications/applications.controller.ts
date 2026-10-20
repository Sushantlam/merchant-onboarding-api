import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/auth-user';
import { Role } from '../users/role.enum';
import { AuditLog } from '../audit/audit-log.entity';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateApplicationDto } from './dto/update-application.dto';
import { ListApplicationsQuery } from './dto/list-applications.query';
import { AssignReviewerDto } from './dto/assign-reviewer.dto';
import { ReviewDecisionDto } from './dto/review-decision.dto';
import { ApplicationResponseDto, PaginatedApplicationsDto } from './dto/application-response.dto';

@ApiTags('applications')
@ApiBearerAuth()
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Post()
  @Roles(Role.SALES, Role.ADMIN)
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateApplicationDto,
  ): Promise<ApplicationResponseDto> {
    return ApplicationResponseDto.from(await this.applicationsService.create(user, dto));
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListApplicationsQuery,
  ): Promise<PaginatedApplicationsDto> {
    const page = await this.applicationsService.list(user, query);
    return { data: page.data.map(ApplicationResponseDto.from), meta: page.meta };
  }

  @Get(':id')
  async findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApplicationResponseDto> {
    return ApplicationResponseDto.from(await this.applicationsService.findOne(user, id));
  }

  @Patch(':id')
  @Roles(Role.SALES, Role.ADMIN)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApplicationDto,
  ): Promise<ApplicationResponseDto> {
    return ApplicationResponseDto.from(await this.applicationsService.update(user, id, dto));
  }

  @Post(':id/submit')
  @Roles(Role.SALES, Role.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  async submit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApplicationResponseDto> {
    return ApplicationResponseDto.from(await this.applicationsService.submit(user, id));
  }

  @Post(':id/assign')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async assign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignReviewerDto,
  ): Promise<ApplicationResponseDto> {
    return ApplicationResponseDto.from(
      await this.applicationsService.assignReviewer(user, id, dto.reviewerId),
    );
  }

  @Post(':id/decision')
  @Roles(Role.REVIEWER)
  @HttpCode(HttpStatus.OK)
  async decide(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDecisionDto,
  ): Promise<ApplicationResponseDto> {
    return ApplicationResponseDto.from(await this.applicationsService.decide(user, id, dto));
  }

  @Post(':id/risk-review/retry')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  async retryRiskReview(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApplicationResponseDto> {
    return ApplicationResponseDto.from(await this.applicationsService.retryRiskReview(user, id));
  }

  @Get(':id/audit')
  @Roles(Role.ADMIN, Role.REVIEWER)
  auditTrail(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AuditLog[]> {
    return this.applicationsService.auditTrail(user, id);
  }
}
