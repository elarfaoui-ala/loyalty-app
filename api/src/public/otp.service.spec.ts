import { BadRequestException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { MailService } from '../common/mail.service';
import { PrismaService } from '../prisma.service';
import { OtpService } from './otp.service';

jest.mock('argon2');

const prisma = {
  otpCode: { deleteMany: jest.fn(), updateMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
} as unknown as PrismaService;

function setTransaction(fn: (items: unknown[]) => unknown) {
  (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn(fn);
}

const mail = { sendOtp: jest.fn().mockResolvedValue({ sentVia: 'log' }) } as unknown as MailService;

describe('OtpService', () => {
  const service = new OtpService(prisma, mail);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('request', () => {
    it('invalidates previous codes, cleans up expired ones and creates a fresh code', async () => {
      (argon2.hash as jest.Mock).mockResolvedValue('hash1');
      setTransaction((items: unknown[]) => Promise.all(items));

      const result = await service.request('biz1', 'a@b.com', 'Test Cafe');

      expect(prisma.otpCode.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });
      expect(prisma.otpCode.updateMany).toHaveBeenCalledWith({
        where: { businessId: 'biz1', identifier: 'a@b.com', consumedAt: null },
        data: { consumedAt: expect.any(Date) },
      });
      expect(prisma.otpCode.create).toHaveBeenCalledWith({
        data: {
          businessId: 'biz1',
          identifier: 'a@b.com',
          codeHash: 'hash1',
          expiresAt: expect.any(Date),
        },
      });
      expect(result).toEqual({ sent: true, expiresInSeconds: 300, sentVia: 'log' });
      expect(mail.sendOtp).toHaveBeenCalledWith(
        'a@b.com',
        expect.stringMatching(/^\d{6}$/),
        300,
        'Test Cafe',
      );
    });
  });

  describe('verify', () => {
    const otp = {
      id: 'otp1',
      businessId: 'biz1',
      identifier: 'a@b.com',
      codeHash: 'hash1',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      attempts: 0,
      createdAt: new Date(),
    };

    it('accepts a correct code and consumes it', async () => {
      prisma.otpCode.findFirst = jest.fn().mockResolvedValue(otp);
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      prisma.otpCode.update = jest.fn().mockResolvedValue(otp);

      await expect(service.verify('biz1', 'a@b.com', '123456')).resolves.toBe(true);
      expect(prisma.otpCode.update).toHaveBeenCalledWith({
        where: { id: 'otp1' },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it('rejects an expired or missing code', async () => {
      prisma.otpCode.findFirst = jest.fn().mockResolvedValue({
        ...otp,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.verify('biz1', 'a@b.com', '123456')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('increments the attempt counter on a wrong code', async () => {
      prisma.otpCode.findFirst = jest.fn().mockResolvedValue(otp);
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(service.verify('biz1', 'a@b.com', '000000')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.otpCode.update).toHaveBeenCalledWith({
        where: { id: 'otp1' },
        data: { attempts: { increment: 1 } },
      });
    });

    it('consumes the code after the attempt cap', async () => {
      prisma.otpCode.findFirst = jest.fn().mockResolvedValue({ ...otp, attempts: 5 });

      await expect(service.verify('biz1', 'a@b.com', '000000')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.otpCode.update).toHaveBeenCalledWith({
        where: { id: 'otp1' },
        data: { consumedAt: expect.any(Date) },
      });
    });
  });
});