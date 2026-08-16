import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { WebhookService } from './webhook.service';
import { WebhooksController } from './webhooks.controller';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [WebhooksController],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhooksModule {}
