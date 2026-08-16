import { RewardType } from '@prisma/client';
import {
  IsEnum,
  IsHexColor,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';

export class UpdateBusinessDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  stampThreshold?: number;

  @IsOptional()
  @IsEnum(RewardType)
  rewardType?: RewardType;

  @IsOptional()
  @IsInt()
  @Min(1)
  rewardValue?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  rewardExpiryDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stampCooldownSec?: number;

  @IsOptional()
  @IsHexColor()
  brandColor?: string;

  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  name?: string;
}
