import { IsEmail, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class RegisterBusinessDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  stampThreshold?: number;
}

export class LoginBusinessDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

export class RefreshTokenDto {
  @IsString()
  refreshToken!: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class LogoutDto {
  @IsString()
  refreshToken!: string;
}
