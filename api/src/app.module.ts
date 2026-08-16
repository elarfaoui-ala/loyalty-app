import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { BusinessesModule } from './businesses/businesses.module';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma.module';
import { PublicModule } from './public/public.module';
import { StampsModule } from './stamps/stamps.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }], // default fallback; per-route overrides via @Throttle
    }),
    PrismaModule,
    AuthModule,
    BusinessesModule,
    StampsModule,
    PublicModule,
    WebhooksModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
