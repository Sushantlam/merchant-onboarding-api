import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNumber,
  IsPositive,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  MinLength,
} from 'class-validator';
import { BusinessType } from '../domain/application-status.enum';

export class CreateApplicationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  businessName: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  legalBusinessName: string;

  @IsEnum(BusinessType)
  businessType: BusinessType;

  @Matches(/^[A-Z0-9-]{6,20}$/i, { message: 'taxId must be 6-20 letters, digits or dashes' })
  taxId: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  ownerName: string;

  @IsEmail()
  ownerEmail: string;

  @Matches(/^\+?[0-9 ()-]{7,20}$/, { message: 'ownerPhone must be a valid phone number' })
  ownerPhone: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(999_999_999_999)
  monthlyVolume: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(9_999_999_999)
  averageTicket: number;

  @Length(4, 4)
  @Matches(/^\d{4}$/, { message: 'merchantCategoryCode must be a 4 digit MCC' })
  merchantCategoryCode: string;
}
