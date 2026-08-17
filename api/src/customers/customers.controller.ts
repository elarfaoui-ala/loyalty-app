import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BusinessJwtGuard } from '../common/guards/business-jwt.guard';
import { CustomersService } from './customers.service';

@ApiTags('customers')
@ApiBearerAuth()
@Controller('businesses/me/customers')
@UseGuards(BusinessJwtGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(
    @Req() req: { businessId: string },
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: 'newest' | 'oldest' | 'stamps_desc' | 'stamps_asc',
  ) {
    return this.customers.list(req.businessId, {
      q,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      sort,
    });
  }

  @Get(':id')
  detail(@Req() req: { businessId: string }, @Param('id') id: string) {
    return this.customers.detail(req.businessId, id);
  }
}
