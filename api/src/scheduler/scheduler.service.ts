import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationService } from '../common/notification.service';
import { PrismaService } from '../prisma.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger('Scheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Runs every hour. Finds all PENDING rewards whose `expiresAt` is in the
   * past and batch-marks them as EXPIRED so they no longer appear as
   * redeemable in the widget and in the dashboard stats.
   */
  @Cron('0 * * * *')
  async expireRewards() {
    const now = new Date();
    const { count } = await this.prisma.reward.updateMany({
      where: { status: 'PENDING', expiresAt: { lt: now } },
      data: { status: 'EXPIRED' },
    });
    if (count > 0) {
      this.logger.log(`Expired ${count} reward(s) past their expiry date`);
    }
  }

  /**
   * Runs daily at 10:00 AM UTC. Sends a reminder email to customers
   * whose rewards expire within the next 3 days.
   */
  @Cron('0 10 * * *')
  async notifyExpiringRewards() {
    const sent = await this.notifications.rewardExpiringSoon();
    if (sent > 0) {
      this.logger.log(`Sent ${sent} reward-expiring-soon reminder(s)`);
    }
  }
}
