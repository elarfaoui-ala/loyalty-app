import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BusinessJwtGuard } from '../common/guards/business-jwt.guard';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [CustomersController],
  providers: [CustomersService, BusinessJwtGuard],
})
export class CustomersModule {}
