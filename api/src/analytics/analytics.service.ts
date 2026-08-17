import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(businessId: string) {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setUTCHours(0, 0, 0, 0);

    const startOfThisWeek = new Date(startOfToday);
    startOfThisWeek.setUTCDate(startOfThisWeek.getUTCDate() - startOfThisWeek.getUTCDay());

    const startOfLastWeek = new Date(startOfThisWeek);
    startOfLastWeek.setUTCDate(startOfLastWeek.getUTCDate() - 7);

    const startOfThisMonth = new Date(startOfToday);
    startOfThisMonth.setUTCDate(1);

    const [
      totalCustomers,
      totalStamps,
      pendingRewards,
      redeemedRewards,
      expiredRewards,
      stampsThisWeek,
      stampsLastWeek,
      stampsThisMonth,
    ] = await Promise.all([
      this.prisma.loyaltyCard.count({ where: { businessId } }),
      this.prisma.stampEvent.count({
        where: { card: { businessId } },
      }),
      this.prisma.reward.count({
        where: { card: { businessId }, status: 'PENDING' },
      }),
      this.prisma.reward.count({
        where: { card: { businessId }, status: 'REDEEMED' },
      }),
      this.prisma.reward.count({
        where: { card: { businessId }, status: 'EXPIRED' },
      }),
      this.prisma.stampEvent.count({
        where: {
          card: { businessId },
          createdAt: { gte: startOfThisWeek },
        },
      }),
      this.prisma.stampEvent.count({
        where: {
          card: { businessId },
          createdAt: { gte: startOfLastWeek, lt: startOfThisWeek },
        },
      }),
      this.prisma.stampEvent.count({
        where: {
          card: { businessId },
          createdAt: { gte: startOfThisMonth },
        },
      }),
    ]);

    const stampGrowth =
      stampsLastWeek > 0
        ? Math.round(((stampsThisWeek - stampsLastWeek) / stampsLastWeek) * 10000) / 100
        : stampsThisWeek > 0
          ? 100
          : 0;

    return {
      customers: totalCustomers,
      stamps: { total: totalStamps, thisWeek: stampsThisWeek, thisMonth: stampsThisMonth, growth: stampGrowth },
      rewards: { pending: pendingRewards, redeemed: redeemedRewards, expired: expiredRewards },
    };
  }

  async trend(businessId: string, days = 30) {
    const windowDays = Math.min(Math.max(days, 1), 90);
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);
    const since = new Date(startOfToday.getTime() - (windowDays - 1) * 86_400_000);

    const daily = await this.prisma.$queryRaw<Array<{
      day: string;
      stamps: number;
      rewards: number;
      redemptions: number;
    }>>(Prisma.sql`
      WITH days AS (
        SELECT generate_series(${since}::date, ${startOfToday}::date, '1 day'::interval)::date AS day
      ),
      s AS (
        SELECT to_char(se."createdAt", 'YYYY-MM-DD') AS day, COUNT(*)::int AS stamps
        FROM "StampEvent" se
        INNER JOIN "LoyaltyCard" c ON c."id" = se."cardId"
        WHERE c."businessId" = ${businessId}
          AND se."createdAt" >= ${since}
        GROUP BY 1
      ),
      r AS (
        SELECT to_char(re."createdAt", 'YYYY-MM-DD') AS day,
               COUNT(*)::int AS rewards,
               COUNT(*) FILTER (WHERE re."status" = 'REDEEMED')::int AS redemptions
        FROM "Reward" re
        INNER JOIN "LoyaltyCard" c ON c."id" = re."cardId"
        WHERE c."businessId" = ${businessId}
          AND re."createdAt" >= ${since}
        GROUP BY 1
      )
      SELECT
        to_char(d.day, 'YYYY-MM-DD') AS "day",
        COALESCE(s.stamps, 0) AS "stamps",
        COALESCE(r.rewards, 0) AS "rewards",
        COALESCE(r.redemptions, 0) AS "redemptions"
      FROM days d
      LEFT JOIN s ON s.day = d.day
      LEFT JOIN r ON r.day = d.day
      ORDER BY d.day ASC
    `);

    return daily.map((d) => ({
      day: d.day,
      stamps: d.stamps,
      rewards: d.rewards,
      redemptions: d.redemptions,
    }));
  }

  async topCustomers(businessId: string, limit = 10) {
    const top = await this.prisma.loyaltyCard.findMany({
      where: { businessId },
      include: {
        customer: {
          select: { id: true, email: true, phone: true, createdAt: true },
        },
      },
      orderBy: { stamps: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
    });

    return top.map((c) => ({
      id: c.customer.id,
      email: c.customer.email,
      phone: c.customer.phone,
      joinedAt: c.customer.createdAt,
      stamps: c.stamps,
      redeemed: c.totalRedeemed,
      lastStampAt: c.lastStampAt,
    }));
  }

  async exportCsv(businessId: string): Promise<string> {
    const stamps = await this.prisma.stampEvent.findMany({
      where: { card: { businessId } },
      include: {
        card: {
          include: {
            customer: { select: { email: true, phone: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const header = 'date,customer_email,customer_phone,source,order_id\n';
    const rows = stamps.map((s) => {
      const date = s.createdAt.toISOString().slice(0, 10);
      const email = s.card.customer.email ?? '';
      const phone = s.card.customer.phone ?? '';
      return `${date},"${email}","${phone}",${s.source},${s.orderId ?? ''}`;
    });

    return header + rows.join('\n');
  }

  async exportRewardsCsv(businessId: string): Promise<string> {
    const rewards = await this.prisma.reward.findMany({
      where: { card: { businessId } },
      include: {
        card: {
          include: {
            customer: { select: { email: true, phone: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const header = 'date,customer_email,customer_phone,type,value,status,redeemed_at,expires_at\n';
    const rows = rewards.map((r) => {
      const date = r.createdAt.toISOString().slice(0, 10);
      const email = r.card.customer.email ?? '';
      const phone = r.card.customer.phone ?? '';
      const redeemed = r.redeemedAt?.toISOString().slice(0, 10) ?? '';
      const expires = r.expiresAt.toISOString().slice(0, 10);
      return `${date},"${email}","${phone}",${r.type},${r.value},${r.status},${redeemed},${expires}`;
    });

    return header + rows.join('\n');
  }
}
