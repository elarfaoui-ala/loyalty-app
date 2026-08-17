import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BusinessJwtGuard } from '../common/guards/business-jwt.guard';
import { AuditService } from './audit.service';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('businesses/me/audit')
@UseGuards(BusinessJwtGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(
    @Req() req: { businessId: string },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.audit.list(req.businessId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
