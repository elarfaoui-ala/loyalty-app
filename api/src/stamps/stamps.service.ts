import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StampSource } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { NotificationService } from '../common/notification.service';
import { WebhookService } from '../webhooks/webhook.service';

interface CreateStampParams {
  businessId: string;
  customerId: string;
  source: StampSource;
  idempotencyKey?: string;
  orderId?: string;
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

@Injectable()
export class StampsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhookService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Records a visit for a customer. Idempotent when `idempotencyKey` is
   * provided (safe to retry from a POS on network failure). Enforces a
   * per-business cooldown between stamps to prevent self-stamping abuse.
   * When the stamp count reaches the business's threshold, a Reward is
   * created and the counter resets.
   *
   * Concurrency notes:
   * - The cooldown is enforced with an atomic conditional update
   *   (`updateMany` guarded by `lastStampAt`), so two simultaneous requests
   *   can never both slip past it.
   * - Idempotency deduplication happens inside the same transaction, so a
   *   retried request returns the original result instead of a conflict.
   */
  async createStamp(params: CreateStampParams) {
    const { businessId, customerId, source, idempotencyKey, orderId } = params;

    const business = await this.prisma.business.findUniqueOrThrow({
      where: { id: businessId },
    });

    return this.prisma.$transaction(async (tx) => {
      // 1. Ensure the card exists (atomic upsert — safe against concurrent
      //    creation for a brand-new customer).
      const card = await tx.loyaltyCard.upsert({
        where: { businessId_customerId: { businessId, customerId } },
        update: {},
        create: { businessId, customerId },
      });

      // 2. Idempotency: a previous identical request already produced this
      //    result — replay it instead of double-stamping.
      if (idempotencyKey) {
        const existing = await tx.stampEvent.findUnique({
          where: { idempotencyKey },
        });
        if (existing) {
          if (existing.cardId !== card.id) {
            throw new ConflictException('Duplicate stamp request');
          }
          const existingCard = await tx.loyaltyCard.findUnique({
            where: { id: existing.cardId },
            include: { rewards: { where: { status: 'PENDING' } } },
          });
          return { card: existingCard!, deduplicated: true };
        }
      }

      // 3. Atomic cooldown claim: the WHERE clause makes the check-and-set
      //    one statement, so a concurrent stamp cannot race past it.
      const cutoff = new Date(
        Date.now() - business.stampCooldownSec * 1000,
      );
      const claim = await tx.loyaltyCard.updateMany({
        where: {
          id: card.id,
          OR: [{ lastStampAt: null }, { lastStampAt: { lt: cutoff } }],
        },
        data: { lastStampAt: new Date() },
      });
      if (claim.count === 0) {
        throw new ConflictException(
          `Please wait before stamping again (cooldown: ${business.stampCooldownSec}s)`,
        );
      }

      // 4. Record the event. A unique-violation here means another request
      //    with the same key won the race for a different card.
      try {
        await tx.stampEvent.create({
          data: { cardId: card.id, source, idempotencyKey, orderId },
        });
      } catch (err) {
        if (idempotencyKey && isUniqueConstraintError(err)) {
          throw new ConflictException('Duplicate stamp request');
        }
        throw err;
      }

      // 5. Increment the counter, granting a reward once the threshold is
      //    reached and resetting the counter.
      const updated = await tx.loyaltyCard.update({
        where: { id: card.id },
        data: { stamps: { increment: 1 } },
      });

      if (updated.stamps < business.stampThreshold) {
        await this.webhooks.emit(
          businessId,
          'STAMP_CREATED',
          {
            cardId: card.id,
            customerId,
            stamps: updated.stamps,
            source,
            orderId: orderId ?? null,
          },
          tx,
        );
        return { card: updated, reward: null, deduplicated: false };
      }

      await tx.loyaltyCard.update({
        where: { id: card.id },
        data: { stamps: 0 },
      });

      const reward = await tx.reward.create({
        data: {
          cardId: card.id,
          type: business.rewardType,
          value: business.rewardValue,
          expiresAt: new Date(
            Date.now() + business.rewardExpiryDays * 24 * 60 * 60 * 1000,
          ),
        },
      });

      await this.webhooks.emit(
        businessId,
        'STAMP_CREATED',
        {
          cardId: card.id,
          customerId,
          stamps: 0,
          source,
          orderId: orderId ?? null,
        },
        tx,
      );
      await this.webhooks.emit(
        businessId,
        'REWARD_CREATED',
        {
          rewardId: reward.id,
          cardId: card.id,
          type: reward.type,
          value: reward.value,
          expiresAt: reward.expiresAt,
          threshold: business.stampThreshold,
        },
        tx,
      );

      // Best-effort email to the customer (non-blocking — don't fail the
      // stamp transaction if email delivery fails).
      this.notifications.rewardEarned({
        customerId,
        businessId,
        rewardType: reward.type,
        rewardValue: reward.value,
        expiresAt: reward.expiresAt,
      }).catch(() => {});

      return {
        card: { ...updated, stamps: 0 },
        reward,
        deduplicated: false,
      };
    });
  }

  async getCard(businessId: string, customerId: string) {
    const card = await this.prisma.loyaltyCard.findUnique({
      where: { businessId_customerId: { businessId, customerId } },
      include: {
        rewards: { where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' } },
        business: {
          select: {
            id: true,
            stampThreshold: true,
            rewardType: true,
            rewardValue: true,
          },
        },
      },
    });
    if (!card) {
      throw new NotFoundException('No loyalty card found for this customer');
    }
    return card;
  }
}
