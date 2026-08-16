import { IsEmail, IsOptional, IsString } from 'class-validator';

export class CreateStampDto {
  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  /** Recommended: pass your own order id here so retries never double-stamp. */
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
