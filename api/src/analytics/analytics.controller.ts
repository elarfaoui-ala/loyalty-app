import { Controller, Get, Req, Query, Res, Header, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { BusinessJwtGuard } from '../common/guards/business-jwt.guard';
import { AuditService } from '../audit/audit.service';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('businesses/me/analytics')
@UseGuards(BusinessJwtGuard)
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly audit: AuditService,
  ) {}

  @ApiOperation({ summary: 'Analytics overview', description: 'Aggregate totals for customers, stamps, rewards, and week-over-week growth.' })
  @Get('overview')
  async overview(@Req() req: { businessId: string }) {
    return this.analytics.overview(req.businessId);
  }

  @ApiOperation({ summary: 'Daily trend', description: 'Per-day stamps, rewards, and redemptions for the last N days.' })
  @ApiQuery({ name: 'days', required: false, description: 'Number of days (1-90, default 30)' })
  @Get('trend')
  async trend(
    @Req() req: { businessId: string },
    @Query('days') days?: string,
  ) {
    return this.analytics.trend(req.businessId, Number(days) || 30);
  }

  @ApiOperation({ summary: 'Top customers', description: 'Customers ranked by total stamps.' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max results (1-50, default 10)' })
  @Get('top-customers')
  async topCustomers(
    @Req() req: { businessId: string },
    @Query('limit') limit?: string,
  ) {
    return this.analytics.topCustomers(req.businessId, Number(limit) || 10);
  }

  @ApiOperation({ summary: 'Export stamps CSV' })
  @Get('export/stamps')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="stamps.csv"')
  async exportStamps(
    @Req() req: { businessId: string },
    @Res() res: Response,
  ) {
    await this.audit.log(req.businessId, 'analytics.exported', { type: 'stamps' });
    const csv = await this.analytics.exportCsv(req.businessId);
    res.send(csv);
  }

  @ApiOperation({ summary: 'Export rewards CSV' })
  @Get('export/rewards')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="rewards.csv"')
  async exportRewards(
    @Req() req: { businessId: string },
    @Res() res: Response,
  ) {
    await this.audit.log(req.businessId, 'analytics.exported', { type: 'rewards' });
    const csv = await this.analytics.exportRewardsCsv(req.businessId);
    res.send(csv);
  }
}
