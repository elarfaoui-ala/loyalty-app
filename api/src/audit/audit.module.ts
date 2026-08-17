import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BusinessJwtGuard } from '../common/guards/business-jwt.guard';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuditController],
  providers: [AuditService, BusinessJwtGuard],
  exports: [AuditService],
})
export class AuditModule {}
