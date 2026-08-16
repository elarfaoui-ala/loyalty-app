import { BadRequestException, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { MailService } from '../common/mail.service';
import { PrismaService } from '../prisma.service';

const MAX_ATTEMPTS = 5;

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /**
   * Issues a fresh one-time code. Invalidates every previously-issued
   * unconsumed code for this identifier (a new request supersedes them) and
   * clears expired rows so the table cannot grow unbounded.
   */
  async request(businessId: string, identifier: string, businessName?: string) {
    const code = generateCode();
    const codeHash = await argon2.hash(code);
    const ttlSeconds = Number(process.env.OTP_TTL_SECONDS ?? 300);

    await this.prisma.$transaction([
      this.prisma.otpCode.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      }),
      this.prisma.otpCode.updateMany({
        where: { businessId, identifier, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.otpCode.create({
        data: {
          businessId,
          identifier,
          codeHash,
          expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        },
      }),
    ]);

    const { sentVia } = await this.mail.sendOtp(identifier, code, ttlSeconds, businessName);
    return { sent: true, expiresInSeconds: ttlSeconds, sentVia };
  }

  async verify(businessId: string, identifier: string, code: string) {
    const otp = await this.prisma.otpCode.findFirst({
      where: { businessId, identifier, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp || otp.expiresAt < new Date()) {
      throw new BadRequestException('Code expired, request a new one');
    }

    if (otp.attempts >= MAX_ATTEMPTS) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { consumedAt: new Date() },
      });
      throw new BadRequestException('Too many attempts, request a new code');
    }

    const valid = await argon2.verify(otp.codeHash, code);
    if (!valid) {
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Invalid code');
    }

    await this.prisma.otpCode.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    });

    return true;
  }
}
