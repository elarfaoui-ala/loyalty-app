import { Injectable, Logger } from '@nestjs/common';

/**
 * Delivers one-time codes to customers.
 *
 * - Email: sent via Resend (https://resend.com) when RESEND_API_KEY is set.
 * - Fallback: printed to the application log (local development).
 *
 * SMS delivery can be added later behind the same interface.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  async sendOtp(
    identifier: string,
    code: string,
    ttlSeconds: number,
    businessName?: string,
  ): Promise<{ sentVia: 'email' | 'log' }> {
    const apiKey = process.env.RESEND_API_KEY;
    const isEmail = identifier.includes('@');

    if (isEmail && apiKey) {
      const from = process.env.MAIL_FROM ?? 'Loyalty <onboarding@resend.dev>';
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [identifier],
          subject: `${businessName ?? 'Your loyalty program'}: your sign-in code`,
          html: this.template(code, ttlSeconds, businessName),
        }),
      });

      if (res.ok) {
        return { sentVia: 'email' };
      }

      // Resend's onboarding domain only delivers to the account owner, and an
      // unverified sending domain is rejected too. Fall back to the console so
      // the widget keeps working instead of returning 500 to the customer.
      this.logger.warn(
        `Resend rejected the OTP email for ${identifier} ` +
          `(HTTP ${res.status}): ${await res.text().catch(() => '')}`,
      );
    }

    this.logger.log(`OTP for ${identifier} (business ${businessName ?? 'unknown'}): ${code}`);
    return { sentVia: 'log' };
  }

  private template(code: string, ttlSeconds: number, businessName?: string): string {
    const minutes = Math.round(ttlSeconds / 60);
    return `
      <div style="font-family: system-ui, sans-serif; max-width: 420px; margin: 0 auto;">
        <h2 style="color: #111827;">${businessName ?? 'Your loyalty program'}</h2>
        <p>Your one-time sign-in code:</p>
        <p style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #111827;">${code}</p>
        <p style="color: #6b7280; font-size: 14px;">It expires in ${minutes} minute${minutes === 1 ? '' : 's'}. Ignore this email if you didn't request it.</p>
      </div>`;
  }
}