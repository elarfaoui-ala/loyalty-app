import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { WebhookEvent } from '@prisma/client';

export class CreateWebhookDto {
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  url!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(WebhookEvent, { each: true })
  events!: WebhookEvent[];

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  enabled?: boolean;
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  url?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(WebhookEvent, { each: true })
  events?: WebhookEvent[];

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  enabled?: boolean;
}

export class ListDeliveriesDto {
  @IsOptional()
  @Type(() => Number)
  limit?: number;
}

export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  STAMP_CREATED: 'stamp.created',
  REWARD_CREATED: 'reward.created',
  REWARD_REDEEMED: 'reward.redeemed',
};
