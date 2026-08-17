import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

/**
 * Sends transactional emails to customers for loyalty events.
 *
 * - Requires `RESEND_API_KEY` and `MAIL_FROM` env vars for live delivery.
 * - Falls back to console logging in development so the app works without
 *   an email provider.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly apiKey = process.env.RESEND_API_KEY;
  private readonly from = process.env.MAIL_FROM ?? 'Loyalty <onboarding@resend.dev>';

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Notifies a customer that they earned a new reward.
   * Called from StampsService after a reward is created.
   */
  async rewardEarned(params: {
    customerId: string;
    businessId: string;
    rewardType: string;
    rewardValue: number;
    expiresAt: Date;
  }) {
    const { customerId, businessId, rewardType, rewardValue, expiresAt } = params;
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true },
    });
    if (!customer?.email || !business) return;

    const rewardLabel = this.rewardLabel(rewardType, rewardValue);
    const subject = `${business.name}: You earned a reward!`;
    const html = `
      <div style="font-family: system-ui, sans-serif; max-width: 420px; margin: 0 auto;">
        <h2 style="color: #111827;">${business.name}</h2>
        <p>Congratulations — you just earned a reward!</p>
        <div style="background: #ecfdf5; border: 1px solid #d1fae5; border-radius: 10px; padding: 16px; margin: 16px 0;">
          <p style="font-size: 18px; font-weight: 700; color: #065f46; margin: 0;">${rewardLabel}</p>
        </div>
        <p style="color: #6b7280; font-size: 14px;">
          This reward expires on ${expiresAt.toLocaleDateString()}. Open the loyalty widget to redeem it.
        </p>
      </div>`;

    await this.send(customer.email, subject, html, `reward-earned-${customerId}`);
  }

  /**
   * Sends a reminder to customers with rewards expiring within `daysAhead`.
   * Called daily by the SchedulerService cron job.
   */
  async rewardExpiringSoon(): Promise<number> {
    const now = new Date();
    const inThreeDays = new Date(now.getTime() + 3 * 86_400_000);

    const rewards = await this.prisma.reward.findMany({
      where: {
        status: 'PENDING',
        expiresAt: { gt: now, lte: inThreeDays },
      },
      include: {
        card: {
          include: {
            customer: { select: { id: true, email: true } },
            business: { select: { id: true, name: true } },
          },
        },
      },
    });

    let sent = 0;
    for (const r of rewards) {
      const { customer, business } = r.card;
      if (!customer.email) continue;

      const daysLeft = Math.max(
        1,
        Math.ceil((r.expiresAt.getTime() - now.getTime()) / 86_400_000),
      );
      const rewardLabel = this.rewardLabel(r.type, r.value);
      const subject = `${business.name}: Your reward expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
      const html = `
        <div style="font-family: system-ui, sans-serif; max-width: 420px; margin: 0 auto;">
          <h2 style="color: #111827;">${business.name}</h2>
          <p>You have a reward that expires soon — don't miss it!</p>
          <div style="background: #fef3c7; border: 1px solid #fde68a; border-radius: 10px; padding: 16px; margin: 16px 0;">
            <p style="font-size: 18px; font-weight: 700; color: #92400e; margin: 0;">${rewardLabel}</p>
            <p style="color: #92400e; font-size: 13px; margin: 8px 0 0;">Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} — ${r.expiresAt.toLocaleDateString()}</p>
          </div>
          <p style="color: #6b7280; font-size: 14px;">
            Open the loyalty widget to redeem your reward before it's gone.
          </p>
        </div>`;

      const ok = await this.send(
        customer.email,
        subject,
        html,
        `reward-expiring-${r.id}`,
      );
      if (ok) sent++;
    }
    return sent;
  }

  private async send(
    to: string,
    subject: string,
    html: string,
    idempotencyKey: string,
  ): Promise<boolean> {
    if (!this.apiKey) {
      this.logger.log(`[notification] ${subject} → ${to}`);
      return true;
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [to],
          subject,
          html,
          headers: { 'X-Idempotency-Key': idempotencyKey },
        }),
      });
      if (!res.ok) {
        this.logger.warn(
          `Resend rejected notification for ${to} (HTTP ${res.status}): ${await res.text().catch(() => '')}`,
        );
        return false;
      }
      return true;
    } catch (err) {
      this.logger.error(`Failed to send notification to ${to}`, err as Error);
      return false;
    }
  }

  private rewardLabel(type: string, value: number): string {
    switch (type) {
      case 'PERCENT_OFF':
        return `${value}% off`;
      case 'FIXED_OFF':
        return `$${(value / 100).toFixed(2)} off`;
      case 'FREE_ITEM':
        return 'Free item';
      default:
        return 'Reward';
    }
  }
}
