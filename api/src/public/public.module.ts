import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MailService } from '../common/mail.service';
import { StampsModule } from '../stamps/stamps.module';
import { OtpService } from './otp.service';
import { PublicController } from './public.controller';

@Module({
  imports: [JwtModule.register({}), StampsModule],
  controllers: [PublicController],
  providers: [OtpService, MailService],
})
export class PublicModule {}
