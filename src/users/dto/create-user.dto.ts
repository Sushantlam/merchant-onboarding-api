import { IsEmail, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { Role } from '../role.enum';

export class CreateUserDto {
  @IsEmail()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password: string;

  @IsEnum(Role)
  role: Role;
}
