import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Business } from '@prisma/client';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { PrismaService } from '../prisma.service';
import { CreateStampDto } from './dto/create-stamp.dto';
import { StampsService } from './stamps.service';

@ApiTags('server-to-server')
@ApiHeader({ name: 'x-api-key', required: true, description: 'Business server-to-server API key' })
@Controller('stamps')
@UseGuards(ApiKeyGuard)
export class StampsController {
  constructor(
    private readonly stamps: StampsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Server-to-server: called from the business's own checkout/POS when an
   * order closes. Requires the `x-api-key` header. Idempotent via
   * `idempotencyKey` (pass your order id) so retries are safe.
   */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Stamp a visit (server-to-server)', description: 'Called by the POS/checkout with the x-api-key header. Idempotent when idempotencyKey is provided.' })
  @Post()
  async create(@Req() req: { business: Business }, @Body() dto: CreateStampDto) {
    if (!dto.customerEmail && !dto.customerPhone) {
      throw new BadRequestException('customerEmail or customerPhone is required');
    }

    // Link email and phone onto one customer record so a person with both
    // identifiers keeps a single loyalty card.
    const customer = await this.prisma.findOrCreateCustomer(
      dto.customerEmail,
      dto.customerPhone,
    );

    return this.stamps.createStamp({
      businessId: req.business.id,
      customerId: customer.id,
      source: 'API',
      idempotencyKey: dto.idempotencyKey,
      orderId: dto.orderId,
    });
  }
}
