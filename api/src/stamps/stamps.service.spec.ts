import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { NotificationService } from '../common/notification.service';
import { WebhookService } from '../webhooks/webhook.service';
import { StampsService } from './stamps.service';

const BUSINESS = {
  id: 'biz1',
  stampThreshold: 10,
  rewardType: 'PERCENT_OFF' as const,
  rewardValue: 100,
  rewardExpiryDays: 30,
  stampCooldownSec: 300,
};

const CARD = {
  id: 'card1',
  businessId: 'biz1',
  customerId: 'cust1',
  stamps: 3,
  totalRedeemed: 0,
  lastStampAt: null,
  createdAt: new Date(),
};

type Tx = {
  loyaltyCard: {
    upsert: jest.Mock;
    findUnique: jest.Mock;
    updateMany: jest.Mock;
    update: jest.Mock;
  };
  stampEvent: { findUnique: jest.Mock; create: jest.Mock };
  reward: { create: jest.Mock };
};

function buildPrisma(tx: Tx): PrismaService {
  const prisma = {
    business: { findUniqueOrThrow: jest.fn().mockResolvedValue(BUSINESS) },
    $transaction: jest.fn((fn: (t: Tx) => unknown) => fn(tx)),
  };
  return prisma as unknown as PrismaService;
}

function buildTx(): Tx {
  return {
    loyaltyCard: {
      upsert: jest.fn().mockResolvedValue(CARD),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue(CARD),
    },
    stampEvent: {
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'evt1' }),
    },
    reward: { create: jest.fn().mockResolvedValue({ id: 'rew1' }) },
  };
}

function buildWebhooks(): WebhookService {
  return {
    emit: jest.fn().mockResolvedValue(undefined),
  } as unknown as WebhookService;
}

function buildNotifications(): NotificationService {
  return {
    rewardEarned: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationService;
}

const BASE_PARAMS = { businessId: 'biz1', customerId: 'cust1', source: 'QR' as const };

describe('StampsService.createStamp', () => {
  it('creates the card, records the event and increments stamps', async () => {
    const tx = buildTx();
    await new StampsService(buildPrisma(tx), buildWebhooks(), buildNotifications()).createStamp(BASE_PARAMS);

    expect(tx.loyaltyCard.upsert).toHaveBeenCalledWith({
      where: { businessId_customerId: { businessId: 'biz1', customerId: 'cust1' } },
      update: {},
      create: { businessId: 'biz1', customerId: 'cust1' },
    });
    expect(tx.loyaltyCard.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'card1',
        OR: [{ lastStampAt: null }, { lastStampAt: { lt: expect.any(Date) } }],
      },
      data: { lastStampAt: expect.any(Date) },
    });
    expect(tx.stampEvent.create).toHaveBeenCalledWith({
      data: { cardId: 'card1', source: 'QR', idempotencyKey: undefined, orderId: undefined },
    });
    expect(tx.loyaltyCard.update).toHaveBeenCalledWith({
      where: { id: 'card1' },
      data: { stamps: { increment: 1 } },
    });
  });

  it('rejects a stamp inside the cooldown window (atomic claim fails)', async () => {
    const tx = buildTx();
    tx.loyaltyCard.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      new StampsService(buildPrisma(tx), buildWebhooks(), buildNotifications()).createStamp(BASE_PARAMS),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.stampEvent.create).not.toHaveBeenCalled();
    expect(tx.loyaltyCard.update).not.toHaveBeenCalled();
  });

  it('replays the original result for a repeated idempotency key', async () => {
    const tx = buildTx();
    tx.stampEvent.findUnique.mockResolvedValue({ id: 'evt1', cardId: 'card1' });
    tx.loyaltyCard.findUnique.mockResolvedValue({
      ...CARD,
      rewards: [{ id: 'rew1', status: 'PENDING' }],
    });

    const result = await new StampsService(buildPrisma(tx), buildWebhooks(), buildNotifications()).createStamp({
      ...BASE_PARAMS,
      idempotencyKey: 'order_1',
    });

    expect(result).toMatchObject({ deduplicated: true });
    expect(tx.loyaltyCard.updateMany).not.toHaveBeenCalled();
    expect(tx.stampEvent.create).not.toHaveBeenCalled();
  });

  it('returns 409 when an idempotency key is replayed for a different card', async () => {
    const tx = buildTx();
    tx.stampEvent.findUnique.mockResolvedValue({ id: 'evt1', cardId: 'OTHER_CARD' });

    await expect(
      new StampsService(buildPrisma(tx), buildWebhooks(), buildNotifications()).createStamp({
        ...BASE_PARAMS,
        idempotencyKey: 'order_1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a reward and resets the counter at the threshold', async () => {
    const tx = buildTx();
    tx.loyaltyCard.update.mockResolvedValueOnce({ ...CARD, stamps: 10 });
    tx.reward.create.mockResolvedValue({ id: 'rew1', type: 'PERCENT_OFF', value: 100 });
    tx.stampEvent.create.mockResolvedValue({ id: 'evt2' });

    const result = await new StampsService(buildPrisma(tx), buildWebhooks(), buildNotifications()).createStamp(BASE_PARAMS);

    expect(tx.reward.create).toHaveBeenCalledWith({
      data: {
        cardId: 'card1',
        type: 'PERCENT_OFF',
        value: 100,
        expiresAt: expect.any(Date),
      },
    });
    expect(tx.loyaltyCard.update).toHaveBeenLastCalledWith({
      where: { id: 'card1' },
      data: { stamps: 0 },
    });
    expect(result).toMatchObject({ reward: { id: 'rew1' }, deduplicated: false });
    expect(result.card.stamps).toBe(0);
  });

  it('does not grant a reward below the threshold', async () => {
    const tx = buildTx();
    tx.loyaltyCard.update.mockResolvedValueOnce({ ...CARD, stamps: 9 });

    const result = await new StampsService(buildPrisma(tx), buildWebhooks(), buildNotifications()).createStamp(BASE_PARAMS);

    expect(tx.reward.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ reward: null });
  });
});