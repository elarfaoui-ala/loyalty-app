import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class CustomerJwtGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const payload = this.jwt.verify(token, {
        secret: process.env.CUSTOMER_TOKEN_SECRET,
      });
      req.customerId = payload.sub;
      req.businessId = payload.businessId;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
