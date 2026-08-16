import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { nanoid } from 'nanoid';

/**
 * Idempotent demo seed. Re-running it only deletes and recreates the records
 * it owns (identified by the emails/phones below); it never touches real data.
 *
 * Run with: npm run db:seed
 */

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'demo-password-123';

const SEED_BUSINESSES = [
  {
    name: 'Seed Cafe',
    email: 'seed-cafe@loyalty-demo.com',
    slug: 'seed-cafe',
    stampThreshold: 10,
    rewardType: 'PERCENT_OFF' as const,
    rewardValue: 100,
    rewardExpiryDays: 30,
    brandColor: '#b45309',
  },
  {
    name: 'Green Grocer',
    email: 'seed-grocer@loyalty-demo.com',
    slug: 'seed-grocer',
    stampThreshold: 8,
    rewardType: 'FREE_ITEM' as const,
    rewardValue: 1,
    rewardExpiryDays: 14,
    brandColor: '#15803d',
  },
];

const SEED_CUSTOMERS = [
  { key: 'alice', email: 'alice@example.com', phone: null },
  { key: 'bob', email: 'bob@example.com', phone: null },
  { key: 'carol', email: 'carol@example.com', phone: null },
  { key: 'dave', email: 'dave@example.com', phone: null },
  { key: 'eve', email: 'eve@example.com', phone: null },
  { key: 'frank', email: null, phone: '+15550101010' },
  { key: 'grace', email: null, phone: '+15550101111' },
] as const;

/** Business email -> (customerKey -> stamps). Cards that pass the threshold get a reward. */
const SEED_CARDS: Record<string, Record<string, number>> = {
  'seed-cafe@loyalty-demo.com': {
    alice: 9,
    bob: 4,
    carol: 0,
    dave: 3,
    eve: 5,
    frank: 2,
  },
  'seed-grocer@loyalty-demo.com': {
    alice: 1,
    grace: 0,
  },
};

/** Business email -> customerKeys that should have a PENDING reward already. */
const SEED_PENDING_REWARDS: Record<string, string[]> = {
  'seed-cafe@loyalty-demo.com': ['dave'],
  'seed-grocer@loyalty-demo.com': ['alice'],
};

/** customerKey -> has a redeemed reward on its Seed Cafe card. */
const SEED_REDEEMED_REWARDS: Record<string, boolean> = {
  eve: true,
};

async function main() {
  const businessEmails = SEED_BUSINESSES.map((b) => b.email);
  const customerEmails = SEED_CUSTOMERS.flatMap((c) => (c.email ? [c.email] : []));
  const customerPhones = SEED_CUSTOMERS.flatMap((c) => (c.phone ? [c.phone] : []));

  const existing = await prisma.business.findMany({
    where: { email: { in: businessEmails } },
    select: { id: true, email: true },
  });
  const existingIds = existing.map((b) => b.id);

  await prisma.$transaction([
    prisma.otpCode.deleteMany({ where: { businessId: { in: existingIds } } }),
    prisma.business.deleteMany({ where: { email: { in: businessEmails } } }),
    prisma.customer.deleteMany({
      where: {
        OR: [{ email: { in: customerEmails } }, { phone: { in: customerPhones } }],
      },
    }),
  ]);

  const customers = new Map<string, string>();
  for (const c of SEED_CUSTOMERS) {
    const row = await prisma.customer.create({
      data: { email: c.email ?? undefined, phone: c.phone ?? undefined },
    });
    customers.set(c.key, row.id);
  }

  const apiKeys: string[] = [];
  for (const b of SEED_BUSINESSES) {
    const passwordHash = await argon2.hash(DEMO_PASSWORD);
    const business = await prisma.business.create({
      data: {
        name: b.name,
        email: b.email,
        slug: b.slug,
        passwordHash,
        apiKeyHash: 'pending',
        stampThreshold: b.stampThreshold,
        rewardType: b.rewardType,
        rewardValue: b.rewardValue,
        rewardExpiryDays: b.rewardExpiryDays,
        brandColor: b.brandColor,
      },
    });

    const apiKey = `biz_${business.id}.${nanoid(32)}`;
    const apiKeyHash = await argon2.hash(apiKey);
    await prisma.business.update({
      where: { id: business.id },
      data: { apiKeyHash },
    });
    apiKeys.push(apiKey);

    const stampConfig = SEED_CARDS[b.email] ?? {};
    const pendingKeys = SEED_PENDING_REWARDS[b.email] ?? [];
    const redeemedKeys = Object.keys(SEED_REDEEMED_REWARDS);

    for (const [customerKey, stamps] of Object.entries(stampConfig)) {
      const customerId = customers.get(customerKey);
      if (!customerId) continue;

      const hasPending = pendingKeys.includes(customerKey);
      const hasRedeemed = redeemedKeys.includes(customerKey);

      const card = await prisma.loyaltyCard.create({
        data: {
          businessId: business.id,
          customerId,
          stamps,
          totalRedeemed: hasRedeemed ? 1 : 0,
          lastStampAt: stamps > 0 ? new Date(Date.now() - 1000 * 60 * 60 * 24 * 2) : null,
        },
      });

      if (stamps > 0) {
        await prisma.stampEvent.createMany({
          data: Array.from({ length: stamps }, (_, i) => ({
            cardId: card.id,
            source: i % 3 === 0 ? ('API' as const) : ('QR' as const),
            createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * (i + 1)),
          })),
        });
      }

      if (hasPending) {
        await prisma.reward.create({
          data: {
            cardId: card.id,
            type: b.rewardType,
            value: b.rewardValue,
            expiresAt: new Date(
              Date.now() + b.rewardExpiryDays * 24 * 60 * 60 * 1000,
            ),
          },
        });
      }

      if (hasRedeemed) {
        await prisma.reward.create({
          data: {
            cardId: card.id,
            type: b.rewardType,
            value: b.rewardValue,
            status: 'REDEEMED',
            redeemedAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
            expiresAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
          },
        });
      }
    }
  }

  console.log('\nSeeded demo data:\n');
  console.log('  Businesses (login password: ' + DEMO_PASSWORD + '):');
  for (const b of SEED_BUSINESSES) {
    console.log(`    - ${b.name}  email: ${b.email}`);
  }
  console.log('\n  Server-to-server API keys (shown once):');
  for (const [i, key] of apiKeys.entries()) {
    console.log(`    - ${SEED_BUSINESSES[i].name}: ${key}`);
  }
  console.log('\n  Cards:');
  for (const [email, cards] of Object.entries(SEED_CARDS)) {
    for (const [customerKey, stamps] of Object.entries(cards)) {
      console.log(`    - ${email} / ${customerKey}: ${stamps} stamps`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
