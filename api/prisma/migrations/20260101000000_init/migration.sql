-- CreateEnum
CREATE TYPE "RewardType" AS ENUM ('PERCENT_OFF', 'FIXED_OFF', 'FREE_ITEM');

-- CreateEnum
CREATE TYPE "RewardStatus" AS ENUM ('PENDING', 'REDEEMED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "StampSource" AS ENUM ('QR', 'API', 'MANUAL');

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "stampThreshold" INTEGER NOT NULL DEFAULT 10,
    "rewardType" "RewardType" NOT NULL DEFAULT 'PERCENT_OFF',
    "rewardValue" INTEGER NOT NULL DEFAULT 100,
    "rewardExpiryDays" INTEGER NOT NULL DEFAULT 30,
    "stampCooldownSec" INTEGER NOT NULL DEFAULT 300,
    "brandColor" TEXT NOT NULL DEFAULT '#111827',
    "logoUrl" TEXT,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyCard" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "stamps" INTEGER NOT NULL DEFAULT 0,
    "totalRedeemed" INTEGER NOT NULL DEFAULT 0,
    "lastStampAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StampEvent" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "source" "StampSource" NOT NULL,
    "idempotencyKey" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StampEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reward" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "type" "RewardType" NOT NULL,
    "value" INTEGER NOT NULL,
    "status" "RewardStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Business_email_key" ON "Business"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Business_apiKeyHash_key" ON "Business"("apiKeyHash");

-- CreateIndex
CREATE INDEX "Business_slug_idx" ON "Business"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_email_key" ON "Customer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phone_key" ON "Customer"("phone");

-- CreateIndex
CREATE INDEX "LoyaltyCard_businessId_idx" ON "LoyaltyCard"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyCard_businessId_customerId_key" ON "LoyaltyCard"("businessId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "StampEvent_idempotencyKey_key" ON "StampEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StampEvent_cardId_idx" ON "StampEvent"("cardId");

-- CreateIndex
CREATE INDEX "Reward_cardId_idx" ON "Reward"("cardId");

-- CreateIndex
CREATE INDEX "Reward_status_idx" ON "Reward"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_fingerprint_key" ON "RefreshToken"("fingerprint");

-- CreateIndex
CREATE INDEX "RefreshToken_businessId_idx" ON "RefreshToken"("businessId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "OtpCode_businessId_identifier_createdAt_idx" ON "OtpCode"("businessId", "identifier", "createdAt");

-- CreateIndex
CREATE INDEX "OtpCode_expiresAt_idx" ON "OtpCode"("expiresAt");

-- AddForeignKey
ALTER TABLE "LoyaltyCard" ADD CONSTRAINT "LoyaltyCard_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyCard" ADD CONSTRAINT "LoyaltyCard_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StampEvent" ADD CONSTRAINT "StampEvent_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "LoyaltyCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reward" ADD CONSTRAINT "Reward_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "LoyaltyCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
