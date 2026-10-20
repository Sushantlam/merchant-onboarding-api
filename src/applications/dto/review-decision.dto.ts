import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ReviewDecision } from '../domain/application-status.enum';

export class ReviewDecisionDto {
  @IsEnum(ReviewDecision)
  decision: ReviewDecision;

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  note?: string;
}
