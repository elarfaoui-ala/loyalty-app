import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { TenantThrottlerGuard } from './common/guards/tenant-throttler.guard';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { BusinessesModule } from './businesses/businesses.module';
import { CustomersModule } from './customers/customers.module';
import { AccessLogInterceptor } from './common/interceptors/access-log.interceptor';
import { NotificationModule } from './common/notification.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma.module';
import { PublicModule } from './public/public.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { StampsModule } from './stamps/stamps.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
    }),
    PrismaModule,
    ScheduleModule.forRoot(),
    AuthModule,
    AuditModule,
    BusinessesModule,
    CustomersModule,
    StampsModule,
    PublicModule,
    NotificationModule,
    SchedulerModule,
    WebhooksModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: TenantThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: AccessLogInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
