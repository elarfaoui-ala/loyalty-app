import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash } from 'crypto';
import { nanoid } from 'nanoid';
import { PrismaService } from '../prisma.service';
import { LoginBusinessDto, RegisterBusinessDto } from './dto/auth.dto';

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') +
    '-' +
    nanoid(6).toLowerCase()
  );
}

function fingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Parses jwt-style TTL strings ("30d", "15m", "8h", "2w") into milliseconds. */
function ttlToMs(ttl: string, fallbackMs: number): number {
  const match = /^(\d+)(s|m|h|d|w)$/.exec(ttl.trim());
  if (!match) return fallbackMs;
  const value = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  return value * multipliers[unit];
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Registers a business and returns its plaintext API key ONCE. */
  async register(dto: RegisterBusinessDto) {
    const existing = await this.prisma.business.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await argon2.hash(dto.password);

    // Create first to get the cuid, then derive the API key from it so the
    // guard can look the business up by id prefix without a full table scan.
    const business = await this.prisma.business.create({
      data: {
        name: dto.name,
        email: dto.email,
        slug: slugify(dto.name),
        passwordHash,
        apiKeyHash: 'pending',
        stampThreshold: dto.stampThreshold ?? 10,
      },
    });

    const plaintextApiKey = `biz_${business.id}.${nanoid(32)}`;
    const apiKeyHash = await argon2.hash(plaintextApiKey);

    await this.prisma.business.update({
      where: { id: business.id },
      data: { apiKeyHash },
    });

    const tokens = await this.issueTokens(business.id);
    return {
      business: this.toPublicBusiness(business),
      apiKey: plaintextApiKey,
      ...tokens,
    };
  }

  async login(dto: LoginBusinessDto) {
    const business = await this.prisma.business.findUnique({
      where: { email: dto.email },
    });
    if (!business) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await argon2.verify(business.passwordHash, dto.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.issueTokens(business.id);
    return { business: this.toPublicBusiness(business), ...tokens };
  }

  /**
   * Rotates a refresh token. Tokens are looked up by a sha256 fingerprint
   * (O(1)) and matched against any active session for the business, so
   * multiple devices can refresh independently.
   */
  async refresh(refreshToken: string) {
    let payload: { sub: string };
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const stored = await this.prisma.refreshToken.findUnique({
      where: { fingerprint: fingerprint(refreshToken) },
    });
    if (!stored || stored.businessId !== payload.sub) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token revoked or expired');
    }

    const matches = await argon2
      .verify(stored.tokenHash, refreshToken)
      .catch(() => false);
    if (!matches) {
      throw new UnauthorizedException('Refresh token revoked or reused');
    }

    // Rotate: revoke this one, issue a new pair.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(payload.sub);
  }

  /**
   * Changes the business password after checking the current one, revoking
   * every active session. Returns a fresh token pair so the current session
   * survives while all other devices are signed out.
   */
  async changePassword(businessId: string, currentPassword: string, newPassword: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
    });
    if (!business) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await argon2
      .verify(business.passwordHash, currentPassword)
      .catch(() => false);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.business.update({
        where: { id: businessId },
        data: { passwordHash },
      }),
      this.prisma.refreshToken.updateMany({
        where: { businessId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { changed: true, ...(await this.issueTokens(businessId)) };
  }

  /** Revokes the presented refresh token. Idempotent. */
  async logout(refreshToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { fingerprint: fingerprint(refreshToken) },
    });
    if (stored && !stored.revokedAt) {
      await this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });
    }
    return { loggedOut: true };
  }

  private async issueTokens(businessId: string) {
    // A unique `jti` is mandatory: JWT `iat` only has second granularity, so
    // two issues within the same second would otherwise produce byte-identical
    // tokens whose fingerprints collide on the RefreshToken unique index.
    const accessToken = this.jwt.sign(
      { sub: businessId },
      {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: process.env.JWT_ACCESS_TTL ?? '15m',
        jwtid: nanoid(),
      },
    );
    const refreshToken = this.jwt.sign(
      { sub: businessId },
      {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: process.env.JWT_REFRESH_TTL ?? '30d',
        jwtid: nanoid(),
      },
    );

    const tokenHash = await argon2.hash(refreshToken);
    const expiresMs = ttlToMs(
      process.env.JWT_REFRESH_TTL ?? '30d',
      30 * 24 * 60 * 60 * 1000,
    );
    await this.prisma.refreshToken.create({
      data: {
        businessId,
        tokenHash,
        fingerprint: fingerprint(refreshToken),
        expiresAt: new Date(Date.now() + expiresMs),
      },
    });

    return { accessToken, refreshToken };
  }

  private toPublicBusiness(business: {
    id: string;
    name: string;
    slug: string;
    email: string;
    stampThreshold: number;
  }) {
    const { id, name, slug, email, stampThreshold } = business;
    return { id, name, slug, email, stampThreshold };
  }
}
