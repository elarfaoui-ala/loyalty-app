import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request } from 'express';

@Injectable()
export class AccessLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { requestId?: string }>();
    const { method, url } = req;
    const requestId = req.requestId ?? '';
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - start;
        const res = context.switchToHttp().getResponse();
        const status: number = res.statusCode;

        // Suppress health-check noise in production.
        if (process.env.NODE_ENV === 'production' && url.includes('/health')) {
          return;
        }

        const prefix = requestId ? `[${requestId}] ` : '';
        this.logger.log(`${prefix}${method} ${url} ${status} ${duration}ms`);
      }),
    );
  }
}
