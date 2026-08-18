import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [JwtModule.register({}), AuditModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
