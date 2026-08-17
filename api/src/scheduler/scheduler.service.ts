import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger('Scheduler');

  constructor(private readonly prisma: PrismaService) {}

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
}
