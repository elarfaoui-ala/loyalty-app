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
import { Prisma } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BusinessJwtGuard } from '../common/guards/business-jwt.guard';
import { AuditService } from '../audit/audit.service';
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
    private readonly audit: AuditService,
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
    const ep = await this.prisma.webhookEndpoint.create({
      data: {
        businessId: req.businessId,
        url: dto.url,
        secret,
        events: dto.events,
        enabled: dto.enabled ?? true,
      },
    });
    await this.audit.log(req.businessId, 'webhook.created', {
      endpointId: ep.id,
      url: dto.url,
      events: dto.events,
    });
    return ep;
  }

  @ApiOperation({ summary: 'Update a webhook endpoint' })
  @Patch(':id')
  async update(
    @Req() req: { businessId: string },
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    const ep = await this.findEndpoint(req.businessId, id);
    const updated = await this.prisma.webhookEndpoint.update({
      where: { id: ep.id },
      data: {
        ...(dto.url !== undefined ? { url: dto.url } : {}),
        ...(dto.events !== undefined ? { events: dto.events } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
      },
    });
    await this.audit.log(req.businessId, 'webhook.updated', {
      endpointId: ep.id,
      ...dto,
    });
    return updated;
  }

  @ApiOperation({ summary: 'Delete a webhook endpoint' })
  @Delete(':id')
  async remove(@Req() req: { businessId: string }, @Param('id') id: string) {
    const ep = await this.findEndpoint(req.businessId, id);
    await this.prisma.webhookEndpoint.delete({ where: { id: ep.id } });
    await this.audit.log(req.businessId, 'webhook.deleted', {
      endpointId: ep.id,
      url: ep.url,
    });
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
    await this.audit.log(req.businessId, 'webhook.tested', { endpointId: id });
    return { ok: true, note: 'Test event queued — delivery may take a few seconds.' };
  }

  @ApiOperation({ summary: 'Webhook delivery stats', description: 'Aggregate delivery totals, success rate, retries, and a per-day series for the last N days (default 14, max 90).' })
  @Get('stats')
  async stats(
    @Req() req: { businessId: string },
    @Query('days') days?: string,
  ) {
    const windowDays = Math.min(Math.max(Number(days) || 14, 1), 90);
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const since = new Date(
      startOfToday.getTime() - (windowDays - 1) * 86_400_000,
    );

    const [endpointTotal, endpointEnabled, aggregate, daily] =
      await Promise.all([
        this.prisma.webhookEndpoint.count({
          where: { businessId: req.businessId },
        }),
        this.prisma.webhookEndpoint.count({
          where: { businessId: req.businessId, enabled: true },
        }),
        this.prisma.$queryRaw<Array<{
          total: number;
          sent: number;
          failed: number;
          pending: number;
          totalAttempts: number;
          retries: number;
        }>>(Prisma.sql`
          SELECT
            COUNT(*)::int AS "total",
            COUNT(*) FILTER (WHERE d."status" = 'SENT')::int AS "sent",
            COUNT(*) FILTER (WHERE d."status" = 'FAILED')::int AS "failed",
            COUNT(*) FILTER (WHERE d."status" = 'PENDING')::int AS "pending",
            COALESCE(SUM(d."attempts"), 0)::int AS "totalAttempts",
            COALESCE(SUM(GREATEST(d."attempts" - 1, 0)), 0)::int AS "retries"
          FROM "WebhookDelivery" d
          INNER JOIN "WebhookEndpoint" e ON e."id" = d."endpointId"
          WHERE e."businessId" = ${req.businessId}
        `),
        this.prisma.$queryRaw<Array<{
          day: string;
          sent: number;
          failed: number;
          pending: number;
        }>>(Prisma.sql`
          SELECT
            to_char(d."createdAt", 'YYYY-MM-DD') AS "day",
            COUNT(*) FILTER (WHERE d."status" = 'SENT')::int AS "sent",
            COUNT(*) FILTER (WHERE d."status" = 'FAILED')::int AS "failed",
            COUNT(*) FILTER (WHERE d."status" = 'PENDING')::int AS "pending"
          FROM "WebhookDelivery" d
          INNER JOIN "WebhookEndpoint" e ON e."id" = d."endpointId"
          WHERE e."businessId" = ${req.businessId}
            AND d."createdAt" >= ${since}
          GROUP BY "day"
          ORDER BY "day" ASC
        `),
      ]);

    const totals = aggregate[0] ?? {
      total: 0,
      sent: 0,
      failed: 0,
      pending: 0,
      totalAttempts: 0,
      retries: 0,
    };
    const completed = totals.sent + totals.failed;
    const successRate =
      completed > 0 ? Math.round((totals.sent / completed) * 10_000) / 10_000 : 0;
    const avgAttempts =
      totals.total > 0 ? Math.round((totals.totalAttempts / totals.total) * 100) / 100 : 0;

    const byDay = new Map(daily.map((d) => [d.day, d]));
    const series: Array<{ day: string; sent: number; failed: number; pending: number }> = [];
    for (let i = 0; i < windowDays; i++) {
      const day = new Date(since.getTime() + i * 86_400_000)
        .toISOString()
        .slice(0, 10);
      series.push(byDay.get(day) ?? { day, sent: 0, failed: 0, pending: 0 });
    }

    return {
      endpoints: { total: endpointTotal, enabled: endpointEnabled },
      deliveries: {
        total: totals.total,
        sent: totals.sent,
        failed: totals.failed,
        pending: totals.pending,
        successRate,
        avgAttempts,
        retries: totals.retries,
      },
      daily: series,
    };
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
    await this.audit.log(req.businessId, 'webhook.delivery_redelivered', {
      endpointId: ep.id,
      deliveryId,
    });
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
