import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { Business } from '@prisma/client';
import * as argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { BusinessJwtGuard } from '../common/guards/business-jwt.guard';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma.service';
import { OnboardingDto } from './dto/onboarding.dto';
import { UpdateBusinessDto } from './dto/update-business.dto';

@ApiTags('business')
@ApiBearerAuth()
@Controller('businesses/me')
@UseGuards(BusinessJwtGuard)
export class BusinessesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async me(@Req() req: { businessId: string }) {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: req.businessId },
    });
    return this.toSafeBusiness(business);
  }

  @Patch()
  async update(@Req() req: { businessId: string }, @Body() dto: UpdateBusinessDto) {
    const before = await this.prisma.business.findUniqueOrThrow({
      where: { id: req.businessId },
    });
    const business = await this.prisma.business.update({
      where: { id: req.businessId },
      data: dto,
    });
    await this.audit.log(req.businessId, 'settings.updated', {
      changed: Object.keys(dto),
      previous: Object.fromEntries(
        Object.keys(dto).filter((k) => k in before).map((k) => [k, (before as Record<string, unknown>)[k]]),
      ),
    });
    return this.toSafeBusiness(business);
  }

  /**
   * Marks the owner's onboarding progress. `step` is the number of steps
   * completed so far (0..4). The dashboard advances it when the owner
   * finishes each setup step; steps that are detectable from data (API key
   * created, first stamp earned) are completed automatically on the client.
   */
  @Post('onboarding')
  async onboarding(
    @Req() req: { businessId: string },
    @Body() dto: OnboardingDto,
  ) {
    const business = await this.prisma.business.update({
      where: { id: req.businessId },
      data: { onboardingStep: dto.step },
    });
    return { onboardingStep: business.onboardingStep };
  }

  @Get('stats')
  async stats(@Req() req: { businessId: string }) {
    const [totalCards, totalStamps, pendingRewards, redeemedRewards] =
      await Promise.all([
        this.prisma.loyaltyCard.count({ where: { businessId: req.businessId } }),
        this.prisma.stampEvent.count({
          where: { card: { businessId: req.businessId } },
        }),
        this.prisma.reward.count({
          where: { card: { businessId: req.businessId }, status: 'PENDING' },
        }),
        this.prisma.reward.count({
          where: { card: { businessId: req.businessId }, status: 'REDEEMED' },
        }),
      ]);
    return { totalCards, totalStamps, pendingRewards, redeemedRewards };
  }

  /**
   * Issued to the staff-facing register screen and re-requested every ~25s
   * to render a fresh QR code customers scan to self check-in.
   */
  @Post('checkin-token')
  issueCheckinToken(@Req() req: { businessId: string }) {
    const token = this.jwt.sign(
      { businessId: req.businessId },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '30s' },
    );
    return { checkinToken: token, expiresInSeconds: 30 };
  }

  /**
   * Regenerates the server-to-server API key. The old key stops working
   * immediately; the new key is returned exactly once.
   */
  @Post('api-keys/rotate')
  async rotateApiKey(@Req() req: { businessId: string }) {
    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: req.businessId },
    });
    const plaintextApiKey = `biz_${business.id}.${nanoid(32)}`;
    const apiKeyHash = await argon2.hash(plaintextApiKey);
    await this.prisma.business.update({
      where: { id: business.id },
      data: { apiKeyHash },
    });
    await this.audit.log(req.businessId, 'api_key.rotated');
    return { apiKey: plaintextApiKey };
  }

  /** Never expose password/API-key hashes to the client. */
  private toSafeBusiness(business: Business) {
    return {
      id: business.id,
      name: business.name,
      slug: business.slug,
      email: business.email,
      createdAt: business.createdAt,
      updatedAt: business.updatedAt,
      stampThreshold: business.stampThreshold,
      rewardType: business.rewardType,
      rewardValue: business.rewardValue,
      rewardExpiryDays: business.rewardExpiryDays,
      stampCooldownSec: business.stampCooldownSec,
      brandColor: business.brandColor,
      logoUrl: business.logoUrl,
      onboardingStep: business.onboardingStep,
      hasApiKey: business.apiKeyHash !== 'pending',
      apiKeyPrefix: `biz_${business.id}.`,
    };
  }
}