import {
  ConflictException,
  INestApplication,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    // Cloud/serverless Postgres (e.g. Neon) has noticeable per-query latency,
    // so interactive transactions need a longer budget than Prisma's default
    // 5s timeout before a slow network expires them mid-flight.
    super({
      transactionOptions: { maxWait: 10_000, timeout: 20_000 },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => {
      await app.close();
    });
  }

  /**
   * Finds or creates a customer by email and/or phone, linking both
   * identifiers onto a single record so a person always keeps one loyalty
   * card. Throws when the identifiers point at two different existing
   * customers (ambiguous data conflict).
   */
  async findOrCreateCustomer(email?: string, phone?: string) {
    if (!email && !phone) {
      throw new ConflictException('email or phone is required');
    }

    if (email && phone) {
      const existing = await this.customer.findFirst({
        where: { OR: [{ email }, { phone }] },
      });
      if (existing) {
        const updateData: { email?: string; phone?: string } = {};
        if (existing.email !== email) updateData.email = email;
        if (existing.phone !== phone) updateData.phone = phone;
        if (Object.keys(updateData).length === 0) return existing;
        try {
          return await this.customer.update({
            where: { id: existing.id },
            data: updateData,
          });
        } catch {
          throw new ConflictException(
            'One of these identifiers is already linked to another account',
          );
        }
      }
    }

    return this.customer.upsert({
      where: email ? { email } : { phone: phone! },
      update: {},
      create: { email, phone },
    });
  }
}
