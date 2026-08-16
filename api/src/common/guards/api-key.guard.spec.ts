import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma.service';
import { ApiKeyGuard } from './api-key.guard';

jest.mock('argon2');

function mockContext(headers: Record<string, string | undefined>) {
  const req: Record<string, unknown> = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as never;
}

const BUSINESS = { id: 'biz1', apiKeyHash: 'hash1' };

const prisma = {
  business: { findUnique: jest.fn() },
} as unknown as PrismaService;

describe('ApiKeyGuard', () => {
  const guard = new ApiKeyGuard(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects requests without the header', async () => {
    await expect(guard.canActivate(mockContext({}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects malformed keys', async () => {
    await expect(
      guard.canActivate(mockContext({ 'x-api-key': 'no-dot-here' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects keys for unknown businesses', async () => {
    prisma.business.findUnique = jest.fn().mockResolvedValue(null);
    await expect(
      guard.canActivate(mockContext({ 'x-api-key': 'biz_unknown.secret' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.business.findUnique).toHaveBeenCalledWith({ where: { id: 'unknown' } });
  });

  it('rejects keys that do not match the stored hash', async () => {
    prisma.business.findUnique = jest.fn().mockResolvedValue(BUSINESS);
    (argon2.verify as jest.Mock).mockResolvedValue(false);

    await expect(
      guard.canActivate(mockContext({ 'x-api-key': 'biz_biz1.wrong' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches the business for a valid key', async () => {
    prisma.business.findUnique = jest.fn().mockResolvedValue(BUSINESS);
    (argon2.verify as jest.Mock).mockResolvedValue(true);

    const req: Record<string, unknown> = { headers: { 'x-api-key': 'biz_biz1.right' } };
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as never;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.business).toBe(BUSINESS);
  });
});