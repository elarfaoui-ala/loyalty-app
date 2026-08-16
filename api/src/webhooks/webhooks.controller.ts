import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BusinessJwtGuard } from '../common/guards/business-jwt.guard';
import { PrismaService } from '../prisma.service';
import { WebhookService } from './webhook.service';
import {
  CreateWebhookDto,
  ListDeliveriesDto,
  UpdateWebhookDto,
} from './dto/webhook.dto';

@ApiTags('business')
@ApiBearerAuth()
@Controller('businesses/me/webhooks')
@UseGuards(BusinessJwtGuard)
export class WebhooksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhookService,
  ) {}

  @ApiOperation({ summary: 'List webhook endpoints' })
  @Get()
  async list(@Req() req: { businessId: string }) {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { businessId: req.businessId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { deliveries: true } } },
    });
    return endpoints.map((ep) => ({
      id: ep.id,
      url: ep.url,
      events: ep.events,
      enabled: ep.enabled,
      createdAt: ep.createdAt,
      updatedAt: ep.updatedAt,
      deliveries: ep._count?.deliveries ?? 0,
    }));
  }

  @ApiOperation({ summary: 'Create a webhook endpoint', description: 'Returns the HMAC signing secret once — store it server-side to verify deliveries.' })
  @Post()
  async create(@Req() req: { businessId: string }, @Body() dto: CreateWebhookDto) {
    const secret = randomBytes(32).toString('hex');
    return this.prisma.webhookEndpoint.create({
      data: {
        businessId: req.businessId,
        url: dto.url,
        secret,
        events: dto.events,
        enabled: dto.enabled ?? true,
      },
    });
  }

  @ApiOperation({ summary: 'Update a webhook endpoint' })
  @Patch(':id')
  async update(
    @Req() req: { businessId: string },
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    const ep = await this.findEndpoint(req.businessId, id);
    return this.prisma.webhookEndpoint.update({
      where: { id: ep.id },
      data: {
        ...(dto.url !== undefined ? { url: dto.url } : {}),
        ...(dto.events !== undefined ? { events: dto.events } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      },
    });
  }

  @ApiOperation({ summary: 'Delete a webhook endpoint' })
  @Delete(':id')
  async remove(@Req() req: { businessId: string }, @Param('id') id: string) {
    const ep = await this.findEndpoint(req.businessId, id);
    await this.prisma.webhookEndpoint.delete({ where: { id: ep.id } });
    return { ok: true };
  }

  @ApiOperation({ summary: 'Send a test delivery', description: 'Queues a synthetic reward.created delivery to this endpoint so you can verify the payload shape and signature.' })
  @Post(':id/test')
  async test(@Req() req: { businessId: string }, @Param('id') id: string) {
    await this.findEndpoint(req.businessId, id); // validates ownership (404)
    await this.webhooks.emit(
      req.businessId,
      'REWARD_CREATED',
      {
        rewardId: 'test-reward',
        cardId: 'test-card',
        type: 'discount',
        value: 1,
        expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
        threshold: 10,
      },
    );
    return { ok: true, note: 'Test event queued — delivery may take a few seconds.' };
  }

  @ApiOperation({ summary: 'Recent delivery attempts for an endpoint' })
  @Get(':id/deliveries')
  async deliveries(
    @Req() req: { businessId: string },
    @Param('id') id: string,
    @Query() query: ListDeliveriesDto,
  ) {
    const ep = await this.findEndpoint(req.businessId, id);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const rows = await this.prisma.webhookDelivery.findMany({
      where: { endpointId: ep.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        event: true,
        status: true,
        attempts: true,
        lastError: true,
        createdAt: true,
        sentAt: true,
      },
    });
    return rows;
  }

  @ApiOperation({ summary: 'Redeliver a dead-lettered delivery', description: 'Re-queues a delivery that exhausted its retries (status FAILED) with a fresh attempt budget.' })
  @Post(':id/deliveries/:deliveryId/retry')
  async retry(
    @Req() req: { businessId: string },
    @Param('id') id: string,
    @Param('deliveryId') deliveryId: string,
  ) {
    const ep = await this.findEndpoint(req.businessId, id);
    const delivery = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, endpointId: ep.id },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    if (delivery.status !== 'FAILED') {
      throw new ConflictException(
        `Only dead-lettered deliveries can be redelivered (status: ${delivery.status})`,
      );
    }
    await this.webhooks.retryDelivery(deliveryId);
    return { retried: true, deliveryId };
  }

  private async findEndpoint(businessId: string, id: string) {
    const ep = await this.prisma.webhookEndpoint.findFirst({
      where: { id, businessId },
    });
    if (!ep) throw new NotFoundException('Webhook endpoint not found');
    return ep;
  }
}
