import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns customers who have a loyalty card with this business.
   * Supports text search by email or phone, pagination, and sorting.
   */
  async list(
    businessId: string,
    opts: {
      q?: string;
      page?: number;
      limit?: number;
      sort?: 'newest' | 'oldest' | 'stamps_desc' | 'stamps_asc';
    } = {},
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const skip = (page - 1) * limit;

    const where = {
      cards: { some: { businessId } },
      ...(opts.q
        ? {
            OR: [
              { email: { contains: opts.q, mode: 'insensitive' as const } },
              { phone: { contains: opts.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const orderBy =
      opts.sort === 'oldest'
        ? { createdAt: 'asc' as const }
        : opts.sort === 'stamps_desc'
          ? { cards: { _count: 'desc' as const } }
          : opts.sort === 'stamps_asc'
            ? { cards: { _count: 'asc' as const } }
            : { createdAt: 'desc' as const };

    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          cards: {
            where: { businessId },
            select: {
              stamps: true,
              totalRedeemed: true,
              lastStampAt: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      items: items.map((c) => ({
        id: c.id,
        email: c.email,
        phone: c.phone,
        createdAt: c.createdAt,
        card: c.cards[0]
          ? {
              stamps: c.cards[0].stamps,
              totalRedeemed: c.cards[0].totalRedeemed,
              lastStampAt: c.cards[0].lastStampAt,
              joinedAt: c.cards[0].createdAt,
            }
          : null,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Returns a single customer with full stamp and reward history.
   */
  async detail(businessId: string, customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        cards: {
          where: { businessId },
          include: {
            stampEvents: { orderBy: { createdAt: 'desc' } },
            rewards: { orderBy: { createdAt: 'desc' } },
          },
        },
      },
    });

    if (!customer || customer.cards.length === 0) {
      throw new NotFoundException('Customer not found for this business');
    }

    const card = customer.cards[0];
    return {
      id: customer.id,
      email: customer.email,
      phone: customer.phone,
      createdAt: customer.createdAt,
      card: {
        id: card.id,
        stamps: card.stamps,
        totalRedeemed: card.totalRedeemed,
        lastStampAt: card.lastStampAt,
        joinedAt: card.createdAt,
        stampEvents: card.stampEvents.map((e) => ({
          id: e.id,
          source: e.source,
          orderId: e.orderId,
          createdAt: e.createdAt,
        })),
        rewards: card.rewards.map((r) => ({
          id: r.id,
          type: r.type,
          value: r.value,
          status: r.status,
          createdAt: r.createdAt,
          redeemedAt: r.redeemedAt,
          expiresAt: r.expiresAt,
        })),
      },
    };
  }

  /**
   * Manually creates a customer and their loyalty card for this business.
   * Used by the business owner from the dashboard.
   */
  async create(businessId: string, email?: string, phone?: string) {
    const existing = await this.prisma.customer.findFirst({
      where: {
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
      },
      include: {
        cards: { where: { businessId }, select: { id: true } },
      },
    });

    if (existing) {
      if (existing.cards.length > 0) {
        throw new ConflictException(
          'A customer with this email or phone already exists for this business',
        );
      }
      // Customer exists from another business — just link them to this one.
      const card = await this.prisma.loyaltyCard.create({
        data: { businessId, customerId: existing.id },
      });
      return { id: existing.id, email: existing.email, phone: existing.phone, card };
    }

    const customer = await this.prisma.customer.create({
      data: { email: email ?? undefined, phone: phone ?? undefined },
    });
    const card = await this.prisma.loyaltyCard.create({
      data: { businessId, customerId: customer.id },
    });
    return { id: customer.id, email: customer.email, phone: customer.phone, card };
  }
}
