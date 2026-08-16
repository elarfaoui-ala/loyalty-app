import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BusinessJwtGuard } from '../common/guards/business-jwt.guard';
import { BusinessesController } from './businesses.controller';

@Module({
  imports: [JwtModule.register({})],
  controllers: [BusinessesController],
  providers: [BusinessJwtGuard],
})
export class BusinessesModule {}
