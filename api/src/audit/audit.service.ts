import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records a business action. Call this from controllers after a
   * successful state-changing operation.
   *
   * @param businessId  The authenticated business.
   * @param action      Dot-separated action key, e.g. "settings.updated".
   * @param details     Optional structured payload (old/new values, IDs, etc.).
   */
  async log(
    businessId: string,
    action: string,
    details?: Record<string, unknown>,
  ) {
    await this.prisma.auditLog.create({
      data: {
        businessId,
        action,
        details: (details as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      },
    });
  }

  async list(
    businessId: string,
    opts: { page?: number; limit?: number } = {},
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
    const skip = (page - 1) * limit;

    const where = { businessId };

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
