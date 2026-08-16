import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma.service';
import { AuthService } from './auth.service';

jest.mock('argon2');

const prisma = {
  business: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: {
    findUnique: jest.fn(),
    create: jest.fn().mockResolvedValue({ id: 'rt1' }),
    update: jest.fn().mockResolvedValue({ id: 'rt1' }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  $transaction: jest.fn((items: unknown[]) => Promise.all(items)),
} as unknown as PrismaService;

function buildService(): AuthService {
  process.env.JWT_ACCESS_SECRET = 'unit-test-access-secret';
  process.env.JWT_REFRESH_SECRET = 'unit-test-refresh-secret';
  process.env.JWT_ACCESS_TTL = '15m';
  process.env.JWT_REFRESH_TTL = '30d';
  return new AuthService(prisma, new JwtService({}));
}

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('changePassword', () => {
    const business = {
      id: 'biz1',
      name: 'Test Cafe',
      email: 'owner@test.com',
      slug: 'test-cafe',
      passwordHash: 'old-hash',
    };

    it('rejects when the current password is wrong', async () => {
      prisma.business.findUnique = jest.fn().mockResolvedValue(business);
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        buildService().changePassword('biz1', 'wrong', 'a-new-password-123'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.business.update).not.toHaveBeenCalled();
    });

    it('updates the password and revokes every active session', async () => {
      prisma.business.findUnique = jest.fn().mockResolvedValue(business);
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      (argon2.hash as jest.Mock).mockResolvedValue('new-hash');
      prisma.business.update = jest.fn().mockResolvedValue(business);

      const result = await buildService().changePassword(
        'biz1',
        'current-password',
        'a-new-password-123',
      );

      expect(prisma.business.update).toHaveBeenCalledWith({
        where: { id: 'biz1' },
        data: { passwordHash: 'new-hash' },
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { businessId: 'biz1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(result).toMatchObject({ changed: true });
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });
  });

  describe('logout', () => {
    it('revokes the presented refresh token', async () => {
      prisma.refreshToken.findUnique = jest
        .fn()
        .mockResolvedValue({ id: 'rt1', revokedAt: null });

      await expect(buildService().logout('some-refresh-token')).resolves.toEqual({
        loggedOut: true,
      });
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt1' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('is idempotent when the token is unknown or already revoked', async () => {
      prisma.refreshToken.findUnique = jest.fn().mockResolvedValue(null);

      await expect(buildService().logout('unknown-token')).resolves.toEqual({
        loggedOut: true,
      });
      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    });
  });
});
