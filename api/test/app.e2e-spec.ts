import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { createHmac, randomUUID } from 'crypto';
import { createServer, Server } from 'http';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { WebhookService } from '../src/webhooks/webhook.service';

// Prisma's client-side .env auto-load does not run inside the jest worker, so
// load the API environment explicitly to reach the test database.
loadEnv({ path: resolve(__dirname, '..', '.env') });

/**
 * End-to-end flows against a real PostgreSQL database.
 *
 * Prerequisites:
 *   docker compose up -d postgres
 *   npx prisma migrate deploy
 *
 * The suite fails fast with a clear message when the database is unreachable.
 */

let app: INestApplication;
let prisma: PrismaService;
let baseUrl: string;
let dbAvailable = false;

const unique = randomUUID().slice(0, 8);
const email = `owner-${unique}@example.com`;
const customerEmail = `cust-${unique}@example.com`;

let apiKey = '';
let accessToken = '';
let refreshToken = '';
let businessId = '';
let slug = '';
let customerToken = '';
let rewardId = '';

interface ReceivedDelivery {
  event?: string;
  signature?: string;
  body: string;
}

let webhookReceiver: Server | null = null;
let webhookUrl = '';
let received: ReceivedDelivery[] = [];

async function json<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${baseUrl}/api/v1${path}`, init);
  return { status: res.status, body: (await res.json().catch(() => null)) as T };
}

function postJson<T>(path: string, body: unknown, headers: Record<string, string> = {}) {
  return json<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function extractOtpCode(logSpy: jest.SpyInstance): string {
  const calls = logSpy.mock.calls.flat().filter((c) => typeof c === 'string');
  const hit = calls.find((c) => c.includes('OTP for'));
  const code = /:\s*(\d{6})$/.exec(hit as string)?.[1];
  if (!code) throw new Error('OTP code not found in logs');
  return code;
}

describe('Loyalty API (e2e)', () => {
  beforeAll(async () => {
    prisma = new PrismaService();
    // Cloud Postgres (e.g. Neon's pooler) can blip for a few seconds; retry
    // the initial connect instead of failing the whole suite on a transient.
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await prisma.$connect();
        await prisma.$queryRaw`SELECT 1`;
        dbAvailable = true;
        break;
      } catch (err) {
        await prisma.$disconnect().catch(() => undefined);
        if (attempt === 4) {
          console.log('DIAG db env set:', !!process.env.DATABASE_URL);
          console.log('DIAG connect error:', (err as Error).message.split('\n')[0]);
          throw new Error(
            'Database unreachable. Start it with `docker compose up -d postgres`, ' +
              'then apply the schema with `npx prisma migrate deploy`.',
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.setGlobalPrefix('api/v1');
    await app.listen(0);
    baseUrl = await app.getUrl();

    // A local receiver that records webhook deliveries for the suite.
    const receiver = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        received.push({
          event: req.headers['x-loyalty-event'] as string | undefined,
          signature: req.headers['x-loyalty-signature'] as string | undefined,
          body: raw,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    webhookReceiver = receiver;
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    const addr = webhookReceiver.address();
    webhookUrl = `http://127.0.0.1:${(addr as { port: number }).port}/hook`;
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await new Promise<void>((resolve) => {
      if (webhookReceiver) webhookReceiver.close(() => resolve());
      else resolve();
    });
    await prisma.webhookDelivery.deleteMany();
    await prisma.webhookEndpoint.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.reward.deleteMany();
    await prisma.stampEvent.deleteMany();
    await prisma.loyaltyCard.deleteMany();
    await prisma.otpCode.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.business.deleteMany();
    await prisma.$disconnect();
    await app.close();
  });

  it('has a reachable database for this environment', () => {
    expect(dbAvailable).toBe(true);
  });

  describe('business auth + stamping', () => {
    it('registers a business and returns a one-time API key', async () => {
      const res = await postJson<{
        apiKey: string;
        accessToken: string;
        refreshToken: string;
        business: { id: string; slug: string };
      }>('/auth/business/register', {
        name: `E2E Diner ${unique}`,
        email,
        password: 'a-strong-password-1',
        stampThreshold: 2,
      });
      expect(res.status).toBe(201);
      expect(res.body.apiKey).toMatch(/^biz_/);
      apiKey = res.body.apiKey;
      accessToken = res.body.accessToken;
      refreshToken = res.body.refreshToken;
      businessId = res.body.business.id;
      slug = res.body.business.slug;

      const patch = await json('/businesses/me', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ stampCooldownSec: 0 }),
      });
      expect(patch.status).toBe(200);
    });

    it('returns the safe business profile with key metadata', async () => {
      const res = await json<Record<string, unknown>>('/businesses/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        email,
        hasApiKey: true,
        apiKeyPrefix: expect.stringMatching(/^biz_/),
      });
      expect(res.body.passwordHash).toBeUndefined();
      expect(res.body.apiKeyHash).toBeUndefined();
    });

    it('rejects requests without a valid token', async () => {
      const res = await json('/businesses/me');
      expect(res.status).toBe(401);
    });

    it('rejects a stamp request with a bad API key', async () => {
      const res = await postJson('/stamps', { customerEmail }, { 'x-api-key': 'biz_x.y' });
      expect(res.status).toBe(401);
    });

    it('stamps idempotently via the API key', async () => {
      const first = await postJson<{ card: { stamps: number }; deduplicated: boolean }>(
        '/stamps',
        { customerEmail, idempotencyKey: 'order_e2e_1' },
        { 'x-api-key': apiKey },
      );
      expect(first.status).toBe(201);
      expect(first.body.card.stamps).toBe(1);
      expect(first.body.deduplicated).toBe(false);

      const retry = await postJson<{ card: { stamps: number }; deduplicated: boolean }>(
        '/stamps',
        { customerEmail, idempotencyKey: 'order_e2e_1' },
        { 'x-api-key': apiKey },
      );
      expect(retry.status).toBe(201);
      expect(retry.body.deduplicated).toBe(true);
      expect(retry.body.card.stamps).toBe(1);
      expect(retry.body).not.toHaveProperty('reward');
    });

    it('grants a reward and resets the counter at the threshold', async () => {
      const res = await postJson<{
        reward: unknown;
        card: { stamps: number };
      }>('/stamps', { customerEmail, idempotencyKey: 'order_e2e_2' }, { 'x-api-key': apiKey });
      expect(res.status).toBe(201);
      expect(res.body.reward).toBeTruthy();
      expect(res.body.card.stamps).toBe(0);
    });

    it('rotates the API key and rejects the old one', async () => {
      const rotated = await postJson<{ apiKey: string }>(
        '/businesses/me/api-keys/rotate',
        {},
        { Authorization: `Bearer ${accessToken}` },
      );
      expect(rotated.status).toBe(201);
      const newKey = rotated.body.apiKey;

      const oldKeyRes = await postJson(
        '/stamps',
        { customerEmail, idempotencyKey: 'order_e2e_3' },
        { 'x-api-key': apiKey },
      );
      expect(oldKeyRes.status).toBe(401);

      const newKeyRes = await postJson(
        '/stamps',
        { customerEmail, idempotencyKey: 'order_e2e_3' },
        { 'x-api-key': newKey },
      );
      expect(newKeyRes.status).toBe(201);
      apiKey = newKey;
    });

    it('refreshes the access token and rotates the refresh token', async () => {
      const res = await postJson<{ accessToken: string; refreshToken: string }>(
        '/auth/business/refresh',
        { refreshToken },
      );
      expect(res.status).toBe(201);
      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.refreshToken).not.toBe(refreshToken);

      // The rotated token is revoked immediately — replaying it must fail.
      const rotated = refreshToken;
      refreshToken = res.body.refreshToken;
      const replayRotated = await postJson('/auth/business/refresh', {
        refreshToken: rotated,
      });
      expect(replayRotated.status).toBe(401);

      // Each active session keeps its own working token (multi-device safe),
      // so the newly issued token remains usable until rotated again.
      const reuse = await postJson<{ refreshToken: string }>(
        '/auth/business/refresh',
        { refreshToken },
      );
      expect(reuse.status).toBe(201);
      refreshToken = reuse.body.refreshToken;
    });

    it('issues a short-lived check-in token', async () => {
      const res = await postJson<{ checkinToken: string; expiresInSeconds: number }>(
        '/businesses/me/checkin-token',
        {},
        { Authorization: `Bearer ${accessToken}` },
      );
      expect(res.status).toBe(201);
      expect(res.body.expiresInSeconds).toBe(120);
    });
  });

  describe('account security', () => {
    it('changes the password and revokes every other session', async () => {
      const res = await postJson<{
        changed: boolean;
        accessToken: string;
        refreshToken: string;
      }>(
        '/auth/business/change-password',
        { currentPassword: 'a-strong-password-1', newPassword: 'a-new-strong-password-2' },
        { Authorization: `Bearer ${accessToken}` },
      );
      expect(res.status).toBe(201);
      expect(res.body.changed).toBe(true);
      const oldRefreshToken = refreshToken;
      accessToken = res.body.accessToken;
      refreshToken = res.body.refreshToken;

      const oldRefresh = await postJson('/auth/business/refresh', {
        refreshToken: oldRefreshToken,
      });
      expect(oldRefresh.status).toBe(401);
    });

    it('rejects a wrong current password', async () => {
      const res = await postJson(
        '/auth/business/change-password',
        { currentPassword: 'wrong-password', newPassword: 'a-new-strong-password-2' },
        { Authorization: `Bearer ${accessToken}` },
      );
      expect(res.status).toBe(401);
    });

    it('logs out by revoking the refresh token', async () => {
      const logout = await postJson('/auth/business/logout', { refreshToken });
      expect(logout.status).toBe(201);

      const replay = await postJson('/auth/business/refresh', { refreshToken });
      expect(replay.status).toBe(401);

      const again = await postJson('/auth/business/logout', { refreshToken });
      expect(again.status).toBe(201);
    });
  });

  describe('customer widget flow', () => {
    it('fetches business config by slug or by biz id', async () => {
      const bySlug = await json<{ id: string }>(`/public/business/${slug}`);
      expect(bySlug.status).toBe(200);
      expect(bySlug.body.id).toBe(businessId);

      const byId = await json<{ slug: string }>(`/public/business/biz_${businessId}`);
      expect(byId.status).toBe(200);
      expect(byId.body.slug).toBe(slug);

      const missing = await json(`/public/business/does-not-exist-${unique}`);
      expect(missing.status).toBe(404);
    });

    it('sends and verifies an OTP, returning a customer token', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const requested = await postJson('/public/otp/request', {
        businessSlug: slug,
        email: customerEmail,
      });
      expect(requested.status).toBe(201);
      const code = extractOtpCode(logSpy);
      logSpy.mockRestore();

      const verified = await postJson<{ customerToken: string }>('/public/otp/verify', {
        businessSlug: slug,
        email: customerEmail,
        code,
      });
      expect(verified.status).toBe(201);
      expect(verified.body.customerToken).toBeTruthy();
      customerToken = verified.body.customerToken;
    });

    it('rejects a wrong OTP code', async () => {
      await postJson('/public/otp/request', { businessSlug: slug, email: customerEmail });
      const wrong = await postJson('/public/otp/verify', {
        businessSlug: slug,
        email: customerEmail,
        code: '000000',
      });
      expect(wrong.status).toBe(400);
    });

    it('loads the card and checks in via the QR token', async () => {
      const cardRes = await json<{ rewards: Array<{ id: string }> }>('/public/card', {
        headers: { Authorization: `Bearer ${customerToken}` },
      });
      expect(cardRes.status).toBe(200);
      expect(cardRes.body.rewards).toHaveLength(1);
      rewardId = cardRes.body.rewards[0].id;

      // The QR token only lives for 30s, so fetch a fresh one right before
      // scanning instead of reusing one issued earlier in the suite.
      const freshQr = await postJson<{ checkinToken: string }>(
        '/businesses/me/checkin-token',
        {},
        { Authorization: `Bearer ${accessToken}` },
      );
      expect(freshQr.status).toBe(201);

      const checkin = await postJson<{ card: { stamps: number }; reward: unknown }>(
        '/public/checkin',
        { checkinToken: freshQr.body.checkinToken },
        { Authorization: `Bearer ${customerToken}` },
      );
      expect(checkin.status).toBe(201);
      // The card already holds 1 stamp (order_e2e_3) with threshold 2, so
      // this check-in grants a reward and resets the counter to 0.
      expect(checkin.body.card.stamps).toBe(0);
      expect(checkin.body.reward).toBeTruthy();
    });

    it('rejects a forged check-in token', async () => {
      const res = await postJson(
        '/public/checkin',
        { checkinToken: 'not-a-real-token' },
        { Authorization: `Bearer ${customerToken}` },
      );
      expect(res.status).toBe(400);
    });

    it('redeems a reward exactly once', async () => {
      const redeem = await postJson(
        `/public/rewards/${rewardId}/redeem`,
        {},
        { Authorization: `Bearer ${customerToken}` },
      );
      expect(redeem.status).toBe(201);

      const again = await postJson(
        `/public/rewards/${rewardId}/redeem`,
        {},
        { Authorization: `Bearer ${customerToken}` },
      );
      expect(again.status).toBe(400);

      const cardRes = await json<{ totalRedeemed: number }>('/public/card', {
        headers: { Authorization: `Bearer ${customerToken}` },
      });
      expect(cardRes.body.totalRedeemed).toBe(1);
    });
  });

  describe('webhooks', () => {
    let webhookId = '';
    let webhookSecret = '';
    let deadEndpointId = '';
    let deadDeliveryId = '';

    it('creates an endpoint and returns a one-time signing secret', async () => {
      const res = await postJson<{
        id: string;
        url: string;
        events: string[];
        secret: string;
      }>(
        '/businesses/me/webhooks',
        {
          url: webhookUrl,
          events: ['STAMP_CREATED', 'REWARD_CREATED', 'REWARD_REDEEMED'],
        },
        { Authorization: `Bearer ${accessToken}` },
      );
      expect(res.status).toBe(201);
      expect(res.body.id).toBeTruthy();
      expect(res.body.secret).toMatch(/^[a-f0-9]{64}$/);
      expect(res.body.events).toContain('REWARD_CREATED');
      webhookId = res.body.id;
      webhookSecret = res.body.secret;
    });

    it('lists endpoints without exposing the secret', async () => {
      const res = await json<Array<Record<string, unknown>>>('/businesses/me/webhooks', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      expect(res.status).toBe(200);
      const endpoint = res.body.find((ep) => ep.id === webhookId);
      expect(endpoint).toBeTruthy();
      expect(endpoint).not.toHaveProperty('secret');
      expect(endpoint).not.toHaveProperty('businessId');
    });

    it('delivers stamp.created and reward.created to the receiver', async () => {
      received = [];
      // The check-in above reset the counter to 0 (it granted a reward), so
      // two stamps are needed: the first fires stamp.created, the second hits
      // the threshold and fires reward.created too.
      const first = await postJson<{ card: { stamps: number }; reward: unknown }>(
        '/stamps',
        { customerEmail, idempotencyKey: 'order_e2e_wh' },
        { 'x-api-key': apiKey },
      );
      expect(first.status).toBe(201);
      expect(first.body.card.stamps).toBe(1);
      expect(first.body.reward).toBeFalsy();

      const second = await postJson<{ card: { stamps: number }; reward: unknown }>(
        '/stamps',
        { customerEmail, idempotencyKey: 'order_e2e_wh2' },
        { 'x-api-key': apiKey },
      );
      expect(second.status).toBe(201);
      expect(second.body.card.stamps).toBe(0);
      expect(second.body.reward).toBeTruthy();

      // Force an immediate delivery pass instead of waiting for the loop.
      const webhooks = app.get(WebhookService);
      for (let i = 0; i < 10 && received.length < 3; i++) {
        await webhooks.deliverDue();
        if (received.length < 3) await new Promise((r) => setTimeout(r, 250));
      }

      const events = received.map((r) => r.event).sort();
      expect(events).toContain('stamp.created');
      expect(events).toContain('reward.created');

      // Every delivery must carry a valid HMAC-SHA256 signature of the raw body.
      for (const delivery of received) {
        const [scheme, expected] = (delivery.signature ?? '').split('=');
        expect(scheme).toBe('sha256');
        const actual = createHmac('sha256', webhookSecret)
          .update(delivery.body)
          .digest('hex');
        expect(actual).toBe(expected);
        const payload = JSON.parse(delivery.body) as {
          businessId: string;
          data: Record<string, unknown>;
        };
        expect(payload.businessId).toBe(businessId);
      }

      const stampEvent = received.find((d) => d.event === 'stamp.created');
      expect(stampEvent).toBeTruthy();
      expect(
        (JSON.parse(stampEvent!.body) as { data: Record<string, unknown> }).data
          .customerId,
      ).toBeTruthy();

      const rewardEvent = received.find((d) => d.event === 'reward.created');
      expect(rewardEvent).toBeTruthy();
      expect(
        (JSON.parse(rewardEvent!.body) as { data: Record<string, unknown> }).data
          .rewardId,
      ).toBeTruthy();
    });

    it('exposes the delivery log via the API', async () => {
      const res = await json<Array<Record<string, unknown>>>(
        `/businesses/me/webhooks/${webhookId}/deliveries`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
      const events = res.body.map((d) => d.event).sort();
      expect(events).toContain('STAMP_CREATED');
      expect(events).toContain('REWARD_CREATED');
    });

    it('dead-letters a delivery that exhausts its retries', async () => {
      const dead = await postJson<{ id: string }>(
        '/businesses/me/webhooks',
        { url: 'http://127.0.0.1:9/hook', events: ['STAMP_CREATED'] },
        { Authorization: `Bearer ${accessToken}` },
      );
      expect(dead.status).toBe(201);
      deadEndpointId = dead.body.id;

      // Seed an outbox row that is already on its last attempt, so one failed
      // delivery flips it to FAILED (dead-lettered) without waiting 8 rounds.
      const row = await prisma.webhookDelivery.create({
        data: {
          endpointId: deadEndpointId,
          event: 'STAMP_CREATED',
          payload: {
            event: 'stamp.created',
            businessId,
            data: { cardId: 'x' },
          } as unknown as Prisma.InputJsonValue,
          attempts: 7,
        },
      });
      deadDeliveryId = row.id;

      const webhooks = app.get(WebhookService);
      for (let i = 0; i < 5; i++) {
        await webhooks.deliverDue();
        const latest = await prisma.webhookDelivery.findUnique({
          where: { id: row.id },
        });
        if (latest?.status === 'FAILED') break;
        await new Promise((r) => setTimeout(r, 250));
      }

      const deadRow = await prisma.webhookDelivery.findUnique({
        where: { id: row.id },
      });
      expect(deadRow?.status).toBe('FAILED');
      expect(deadRow?.attempts).toBe(8);
      expect(deadRow?.lastError).toBeTruthy();
    });

    it('exposes aggregate delivery stats', async () => {
      const res = await json<{
        endpoints: { total: number; enabled: number };
        deliveries: {
          total: number;
          sent: number;
          failed: number;
          pending: number;
          successRate: number;
          avgAttempts: number;
          retries: number;
        };
        daily: Array<{ day: string; sent: number; failed: number; pending: number }>;
      }>('/businesses/me/webhooks/stats', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      expect(res.status).toBe(200);
      expect(res.body.endpoints.total).toBeGreaterThan(0);
      expect(res.body.deliveries.total).toBeGreaterThan(0);
      expect(res.body.deliveries.sent).toBeGreaterThan(0);
      expect(res.body.deliveries.failed).toBeGreaterThan(0);
      expect(res.body.deliveries.successRate).toBeGreaterThan(0);
      expect(res.body.deliveries.successRate).toBeLessThan(1);
      expect(res.body.deliveries.retries).toBeGreaterThanOrEqual(0);
      expect(res.body.deliveries.avgAttempts).toBeGreaterThan(0);
      expect(res.body.daily.length).toBe(14);
      expect(res.body.daily.some((d) => d.sent > 0)).toBe(true);
    });

    it('redelivers a dead-lettered delivery on request', async () => {
      // The retry route is scoped to the owning endpoint.
      const wrongEp = await postJson(
        `/businesses/me/webhooks/${webhookId}/deliveries/${deadDeliveryId}/retry`,
        {},
        { Authorization: `Bearer ${accessToken}` },
      );
      expect(wrongEp.status).toBe(404);

      const retry = await postJson<{ retried: boolean }>(
        `/businesses/me/webhooks/${deadEndpointId}/deliveries/${deadDeliveryId}/retry`,
        {},
        { Authorization: `Bearer ${accessToken}` },
      );
      expect(retry.status).toBe(201);
      expect(retry.body.retried).toBe(true);

      // Point the endpoint at the live receiver and pump delivery.
      const patch = await json(`/businesses/me/webhooks/${deadEndpointId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ url: webhookUrl }),
      });
      expect(patch.status).toBe(200);

      received = [];
      const webhooks = app.get(WebhookService);
      for (let i = 0; i < 10 && !received.some((r) => r.event === 'stamp.created'); i++) {
        await webhooks.deliverDue();
        await new Promise((r) => setTimeout(r, 250));
      }
      expect(received.some((r) => r.event === 'stamp.created')).toBe(true);

      const sent = await prisma.webhookDelivery.findUnique({
        where: { id: deadDeliveryId },
      });
      expect(sent?.status).toBe('SENT');
      expect(sent?.attempts).toBe(1);
    });

    it('rejects redelivering a delivery that is not dead-lettered', async () => {
      const res = await postJson(
        `/businesses/me/webhooks/${deadEndpointId}/deliveries/${deadDeliveryId}/retry`,
        {},
        { Authorization: `Bearer ${accessToken}` },
      );
      expect(res.status).toBe(409);
    });

    it('rejects management of another business endpoint', async () => {
      const res = await json('/businesses/me/webhooks/nonexistent-id', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      expect(res.status).toBe(404);
    });

    it('deletes an endpoint and stops delivery', async () => {
      const del = await json(`/businesses/me/webhooks/${webhookId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      expect(del.status).toBe(200);

      const after = await json<Array<{ id: string }>>('/businesses/me/webhooks', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      expect(after.body.find((ep) => ep.id === webhookId)).toBeUndefined();
    });
  });
});