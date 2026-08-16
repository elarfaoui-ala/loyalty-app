import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { StampsController } from './stamps.controller';
import { StampsService } from './stamps.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [StampsController],
  providers: [StampsService, ApiKeyGuard],
  exports: [StampsService],
})
export class StampsModule {}
