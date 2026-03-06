import { PrismaClient, User } from '@prisma/client';
import { ulid } from 'ulid';
import { Env } from '../../config/env';
import { verifyTelegramInitData } from './telegram-auth';

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: Env
  ) {}

  async authenticateWithTelegram(initData: string): Promise<User> {
    const parsed = verifyTelegramInitData(initData, this.env.TELEGRAM_BOT_TOKEN, this.env.TELEGRAM_AUTH_MAX_AGE_SEC);

    return this.prisma.user.upsert({
      where: {
        telegramId: BigInt(parsed.user.id)
      },
      update: {
        username: parsed.user.username,
        firstName: parsed.user.first_name,
        lastName: parsed.user.last_name,
        photoUrl: parsed.user.photo_url,
        languageCode: parsed.user.language_code
      },
      create: {
        telegramId: BigInt(parsed.user.id),
        username: parsed.user.username,
        firstName: parsed.user.first_name,
        lastName: parsed.user.last_name,
        photoUrl: parsed.user.photo_url,
        languageCode: parsed.user.language_code,
        balances: {
          createMany: {
            data: [
              { currency: 'TON', availableMinor: BigInt(0), lockedMinor: BigInt(0) },
              { currency: 'STARS', availableMinor: BigInt(0), lockedMinor: BigInt(0) }
            ]
          }
        }
      }
    });
  }

  async createSession(userId: string): Promise<{ tokenId: string; expiresAt: Date }> {
    const tokenId = ulid();
    const expiresAt = new Date(Date.now() + this.env.JWT_EXPIRES_SEC * 1000);

    await this.prisma.session.create({
      data: {
        userId,
        tokenId,
        expiresAt
      }
    });

    return { tokenId, expiresAt };
  }

  async getUserById(userId: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }

  async revokeSession(tokenId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: {
        tokenId,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });
  }
}
