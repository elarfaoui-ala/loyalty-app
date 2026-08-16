import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { CustomerJwtGuard } from '../common/guards/customer-jwt.guard';
import { PrismaService } from '../prisma.service';
import { StampsService } from '../stamps/stamps.service';
import { WebhookService } from '../webhooks/webhook.service';
import { CheckinDto, RequestOtpDto, VerifyOtpDto } from './dto/public.dto';
import { OtpService } from './otp.service';

@ApiTags('widget')
@Controller('public')
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly stamps: StampsService,
    private readonly jwt: JwtService,
    private readonly webhooks: WebhookService,
  ) {}

  /**
   * Widget bootstrap: branding + loyalty rules, no auth required. Accepts
   * either the business slug (`my-cafe-abc123`) or the raw business id
   * (`biz_<cuid>`-style suffix from the API key) so embeds can use either.
   */
  @ApiOperation({ summary: 'Widget bootstrap', description: 'Branding + loyalty rules for the widget. No auth required.' })
  @Get('business/:slugOrId')
  async getBusiness(@Param('slugOrId') slugOrId: string) {
    const business = await this.findBusiness(slugOrId);
    if (!business) throw new NotFoundException('Business not found');
    return {
      id: business.id,
      name: business.name,
      slug: business.slug,
      brandColor: business.brandColor,
      logoUrl: business.logoUrl,
      stampThreshold: business.stampThreshold,
      rewardType: business.rewardType,
      rewardValue: business.rewardValue,
    };
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request an OTP sign-in code' })
  @Post('otp/request')
  async requestOtp(@Body() dto: RequestOtpDto) {
    const identifier = dto.email ?? dto.phone;
    if (!identifier) throw new BadRequestException('email or phone is required');

    const business = await this.getBusinessOrThrow(dto.businessSlug);
    return this.otp.request(business.id, identifier, business.name);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify the OTP code and receive a customer JWT' })
  @Post('otp/verify')
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    const identifier = dto.email ?? dto.phone;
    if (!identifier) throw new BadRequestException('email or phone is required');

    const business = await this.getBusinessOrThrow(dto.businessSlug);
    await this.otp.verify(business.id, identifier, dto.code);

    const customer = await this.prisma.findOrCreateCustomer(
      dto.email,
      dto.phone,
    );

    const token = this.jwt.sign(
      { sub: customer.id, businessId: business.id },
      {
        secret: process.env.CUSTOMER_TOKEN_SECRET,
        expiresIn: process.env.CUSTOMER_TOKEN_TTL ?? '1h',
      },
    );

    return { customerToken: token };
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the customer loyalty card', description: 'Stamps, rewards and business rules for the authenticated customer.' })
  @UseGuards(CustomerJwtGuard)
  @Get('card')
  async getCard(@Req() req: { businessId: string; customerId: string }) {
    return this.stamps.getCard(req.businessId, req.customerId);
  }

  /**
   * Customer scans the rotating register QR shown by staff. The QR encodes a
   * short-lived JWT for the business; this exchanges it for a stamp.
   */
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Check in by scanning the register QR', description: 'Exchanges a short-lived check-in token for a stamp (fires stamp.created / reward.created webhooks).' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(CustomerJwtGuard)
  @Post('checkin')
  async checkin(
    @Req() req: { businessId: string; customerId: string },
    @Body() dto: CheckinDto,
  ) {
    let payload: { businessId: string };
    try {
      payload = this.jwt.verify(dto.checkinToken, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
    } catch {
      throw new BadRequestException(
        'This QR code has expired, ask staff to refresh it',
      );
    }

    if (payload.businessId !== req.businessId) {
      throw new BadRequestException('QR code does not match this business');
    }

    return this.stamps.createStamp({
      businessId: req.businessId,
      customerId: req.customerId,
      source: 'QR',
    });
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Redeem a reward', description: 'Marks a PENDING reward as redeemed (fires reward.redeemed webhook).' })
  @UseGuards(CustomerJwtGuard)
  @Post('rewards/:id/redeem')
  async redeem(
    @Req() req: { businessId: string; customerId: string },
    @Param('id') rewardId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const reward = await tx.reward.findUnique({
        where: { id: rewardId },
        include: { card: true },
      });
      if (
        !reward ||
        reward.card.businessId !== req.businessId ||
        reward.card.customerId !== req.customerId
      ) {
        throw new NotFoundException('Reward not found');
      }
      if (reward.status !== 'PENDING') {
        throw new BadRequestException(
          `Reward already ${reward.status.toLowerCase()}`,
        );
      }
      if (reward.expiresAt < new Date()) {
        await tx.reward.update({
          where: { id: reward.id },
          data: { status: 'EXPIRED' },
        });
        throw new BadRequestException('Reward expired');
      }

      // Conditional update: only one concurrent redeem can flip PENDING,
      // so a reward can never be double-redeemed.
      const claimed = await tx.reward.updateMany({
        where: { id: reward.id, status: 'PENDING' },
        data: { status: 'REDEEMED', redeemedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new BadRequestException('Reward already redeemed');
      }

      await tx.loyaltyCard.update({
        where: { id: reward.cardId },
        data: { totalRedeemed: { increment: 1 } },
      });

      await this.webhooks.emit(
        req.businessId,
        'REWARD_REDEEMED',
        {
          rewardId: reward.id,
          cardId: reward.cardId,
          redeemedAt: new Date().toISOString(),
        },
        tx,
      );

      return { redeemed: true };
    });
  }

  private async getBusinessOrThrow(slug: string) {
    const business = await this.findBusiness(slug);
    if (!business) throw new NotFoundException('Business not found');
    return business;
  }

  private async findBusiness(slugOrId: string) {
    if (slugOrId.startsWith('biz_') || slugOrId.startsWith('cl')) {
      const byId = await this.prisma.business.findUnique({
        where: { id: slugOrId.replace(/^biz_/, '') },
      });
      if (byId) return byId;
    }
    return this.prisma.business.findUnique({ where: { slug: slugOrId } });
  }
}
