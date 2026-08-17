import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Extends the default ThrottlerGuard to key rate-limit buckets by business
 * identity instead of IP address. This prevents one heavy tenant from
 * starving others on a shared deployment.
 *
 * Strategy:
 * - Business JWT routes (`Authorization: Bearer ...`) → decode (no verify)
 *   and key on the `sub` claim.
 * - API-key routes (`x-api-key: biz_<id>...`) → key on the business ID prefix.
 * - Unauthenticated routes (health, OTP, public) → fall back to IP.
 *
 * We intentionally skip JWT verification here — this guard only determines
 * the rate-limit bucket, not access. The real auth guards still run after.
 */
@Injectable()
export class TenantThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const auth = req.headers as Record<string, string> | undefined;
    const authorization = (auth as Record<string, string> | undefined)
      ?.authorization as string | undefined;

    // Business JWT: extract sub without verification.
    if (authorization?.startsWith('Bearer ')) {
      try {
        const token = authorization.slice(7);
        const payload = JSON.parse(
          Buffer.from(token.split('.')[1], 'base64url').toString(),
        );
        if (payload?.sub) return `business:${payload.sub}`;
      } catch {
        // malformed token — fall through to IP
      }
    }

    // API key: extract business ID from prefix (biz_<id>.<secret>).
    const apiKey = (auth as Record<string, string> | undefined)?.[
      'x-api-key'
    ] as string | undefined;
    if (apiKey) {
      const match = apiKey.match(/^biz_([a-z0-9]+)/);
      if (match) return `apikey:${match[1]}`;
    }

    // Unauthenticated — fall back to IP.
    return (req as Record<string, unknown>).ip as string ?? 'unknown';
  }
}
