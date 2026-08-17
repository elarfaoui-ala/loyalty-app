import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { NotificationService } from './notification.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
