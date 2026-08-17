import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

/**
 * Assigns a unique request ID to every incoming HTTP request.
 *
 * - If the client sends `X-Request-ID`, it is reused (allows distributed
 *   tracing across services that propagate the header).
 * - Otherwise a fresh UUID v4 is generated.
 * - The ID is stored as `req.requestId` for downstream use (filters,
 *   interceptors, structured logs) and returned in the response header.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const id =
      (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    // Express typing does not include requestId — augment as needed.
    (req as Request & { requestId: string }).requestId = id;
    res.setHeader('x-request-id', id);
    next();
  }
}
