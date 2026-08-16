import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class RequestOtpDto {
  @IsString()
  businessSlug!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

export class VerifyOtpDto {
  @IsString()
  businessSlug!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}

export class CheckinDto {
  @IsString()
  checkinToken!: string;
}
