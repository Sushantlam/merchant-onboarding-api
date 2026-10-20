import { IsUUID } from 'class-validator';

export class AssignReviewerDto {
  @IsUUID()
  reviewerId: string;
}
