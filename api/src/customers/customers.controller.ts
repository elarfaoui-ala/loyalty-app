import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
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

  @Post()
  create(
    @Req() req: { businessId: string },
    @Body() body: { email?: string; phone?: string },
  ) {
    if (!body.email && !body.phone) {
      throw new BadRequestException('email or phone is required');
    }
    return this.customers.create(req.businessId, body.email, body.phone);
  }
}
