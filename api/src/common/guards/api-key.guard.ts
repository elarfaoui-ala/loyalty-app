import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma.service';

/**
 * Authenticates server-to-server requests (POS / checkout integrations)
 * via the `x-api-key` header. On success, attaches `req.business`.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const apiKey: string | undefined = req.headers['x-api-key'];

    if (!apiKey) {
      throw new UnauthorizedException('Missing x-api-key header');
    }

    // API keys are stored hashed; we look up candidates by a fast prefix
    // rather than scanning every business. Key format: biz_<id>.<secret>
    const [businessId] = apiKey.split('.');
    if (!businessId) {
      throw new UnauthorizedException('Malformed API key');
    }

    const business = await this.prisma.business.findUnique({
      where: { id: businessId.replace(/^biz_/, '') },
    });
    if (!business) {
      throw new UnauthorizedException('Invalid API key');
    }

    const valid = await argon2.verify(business.apiKeyHash, apiKey);
    if (!valid) {
      throw new UnauthorizedException('Invalid API key');
    }

    req.business = business;
    return true;
  }
}
