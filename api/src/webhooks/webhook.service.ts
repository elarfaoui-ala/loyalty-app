import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHmac } from 'crypto';
import { Prisma, WebhookEvent } from '@prisma/client';
import { PrismaService } from '../prisma.service';

export const WEBHOOK_EVENT_NAMES: Record<WebhookEvent, string> = {
  STAMP_CREATED: 'stamp.created',
  REWARD_CREATED: 'reward.created',
  REWARD_REDEEMED: 'reward.redeemed',
};

const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 15_000;
const MAX_DELAY_MS = 3_600_000; // 1h
const PICKUP_INTERVAL_MS = 10_000;
const DELIVERY_TIMEOUT_MS = 10_000;
const CLAIM_GRACE_MS = 15_000; // reclaim claims abandoned by a crashed worker
const CLAIM_BATCH_SIZE = 50;

type Tx = Prisma.TransactionClient;

@Injectable()
export class WebhookService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookService.name);
  private timer?: NodeJS.Timeout;
  private stopping = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // Fire once shortly after boot, then poll for due deliveries.
    const first = setTimeout(
      () => this.deliverDue().catch(() => {}),
      2_000,
    );
    first.unref();
    this.timer = setInterval(
      () => this.deliverDue().catch((err) => this.logger.error('webhook delivery loop failed', err)),
      PICKUP_INTERVAL_MS,
    );
    this.timer.unref();
  }

  onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Queue a delivery for every enabled endpoint subscribed to `event`.
   * Pass `client` to create the outbox row inside the domain transaction so
   * the webhook cannot be lost if the stamp/reward commit succeeds.
   */
  async emit(
    businessId: string,
    event: WebhookEvent,
    data: Record<string, unknown>,
    client?: Tx,
  ) {
    const db = client ?? this.prisma;
    const endpoints = await db.webhookEndpoint.findMany({
      where: { businessId, enabled: true, events: { has: event } },
    });
    if (endpoints.length === 0) return;

    const now = new Date();
    const payload = {
      event: WEBHOOK_EVENT_NAMES[event],
      businessId,
      timestamp: now.toISOString(),
      data,
    };
    await db.webhookDelivery.createMany({
      data: endpoints.map((ep) => ({
        endpointId: ep.id,
        event,
        payload: payload as unknown as Prisma.InputJsonValue,
      })),
    });
  }

  /** Attempt delivery of every PENDING delivery that is due. */
  async deliverDue() {
    // Claim due rows atomically. `FOR UPDATE SKIP LOCKED` guarantees each row
    // is claimed by exactly one worker, even across API instances, and
    // `claimedAt` (with a grace period) lets a crashed worker's rows be
    // reclaimed instead of being stuck as PENDING forever.
    const claimed = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "WebhookDelivery"
      SET "claimedAt" = ${new Date()}
      WHERE "id" IN (
        SELECT "id" FROM "WebhookDelivery"
        WHERE "status" = 'PENDING'
          AND ("claimedAt" IS NULL OR "claimedAt" < ${new Date(Date.now() - CLAIM_GRACE_MS)})
          AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${new Date()})
        ORDER BY "createdAt" ASC
        LIMIT ${CLAIM_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id"
    `);

    if (claimed.length === 0) return;

    const due = await this.prisma.webhookDelivery.findMany({
      where: { id: { in: claimed.map((c) => c.id) } },
      include: { endpoint: true },
    });

    for (const delivery of due) {
      if (this.stopping) return;
      await this.attempt(delivery).catch((err) =>
        this.logger.error(`delivery ${delivery.id} failed`, err?.stack ?? err),
      );
    }
  }

  private async attempt(delivery: {
    id: string;
    payload: Prisma.JsonValue;
    event: WebhookEvent;
    attempts: number;
    endpoint: { id: string; url: string; secret: string };
  }) {
    const body = JSON.stringify(delivery.payload);
    const signature = createHmac('sha256', delivery.endpoint.secret)
      .update(body)
      .digest('hex');

    let ok = false;
    let lastError: string | null = null;
    try {
      const res = await fetch(delivery.endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-loyalty-event': WEBHOOK_EVENT_NAMES[delivery.event],
          'x-loyalty-signature': `sha256=${signature}`,
          'user-agent': 'loyalty-app-webhooks/1.0',
        },
        body,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });
      ok = res.ok;
      if (!ok) lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    const attempts = delivery.attempts + 1;
    if (ok || attempts >= MAX_ATTEMPTS) {
      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: ok ? 'SENT' : 'FAILED',
          attempts,
          claimedAt: null,
          lastError: ok ? null : lastError,
          sentAt: ok ? new Date() : null,
          nextAttemptAt: null,
        },
      });
      return;
    }

    const delay = Math.min(BASE_DELAY_MS * 2 ** (attempts - 1), MAX_DELAY_MS);
    await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        attempts,
        claimedAt: null,
        lastError,
        nextAttemptAt: new Date(Date.now() + delay),
      },
    });
  }

  /**
   * Re-queue a dead-lettered (FAILED) delivery so it can be attempted again.
   * Gives it a fresh retry budget and clears the claim, so the next pass picks
   * it up. Used by the manual redeliver endpoint.
   */
  async retryDelivery(deliveryId: string) {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
    });
    if (!delivery || delivery.status !== 'FAILED') {
      return false;
    }
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'PENDING',
        attempts: 0,
        claimedAt: null,
        lastError: null,
        nextAttemptAt: null,
        sentAt: null,
      },
    });
    return true;
  }
}
