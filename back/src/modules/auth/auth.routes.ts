import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../shared/errors';

const loginSchema = z.object({
  initData: z.string().min(1)
});

const mockLoginSchema = z.object({
  telegramId: z.coerce.number().int().positive(),
  username: z.string().min(1).max(64).optional(),
  firstName: z.string().min(1).max(128).optional(),
  lastName: z.string().min(1).max(128).optional(),
  languageCode: z.string().min(2).max(16).optional(),
  photoUrl: z.string().url().optional()
});

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/telegram', async (request) => {
    const body = loginSchema.parse(request.body);
    const user = await app.services.auth.authenticateWithTelegram(body.initData);
    const session = await app.services.auth.createSession(user.id);

    const accessToken = await app.jwt.sign(
      {
        sub: user.id,
        sid: session.tokenId
      },
      {
        expiresIn: app.env.JWT_EXPIRES_SEC
      }
    );

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresAt: session.expiresAt,
      user
    };
  });

  app.post('/telegram/mock', async (request) => {
    if (app.env.NODE_ENV === 'production') {
      throw new AppError('Mock Telegram auth is disabled in production', 403, 'MOCK_TELEGRAM_AUTH_DISABLED');
    }

    const body = mockLoginSchema.parse(request.body);
    const user = await app.services.auth.authenticateWithMockTelegram({
      id: body.telegramId,
      username: body.username,
      first_name: body.firstName,
      last_name: body.lastName,
      language_code: body.languageCode,
      photo_url: body.photoUrl
    });

    const session = await app.services.auth.createSession(user.id);
    const accessToken = await app.jwt.sign(
      {
        sub: user.id,
        sid: session.tokenId
      },
      {
        expiresIn: app.env.JWT_EXPIRES_SEC
      }
    );

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresAt: session.expiresAt,
      user,
      mocked: true
    };
  });

  app.get('/me', { preHandler: app.authenticate }, async (request) => {
    const userId = request.authUser.id;
    const [user, balances] = await Promise.all([
      app.services.auth.getUserById(userId),
      app.services.wallet.getBalances(userId)
    ]);

    return {
      user,
      balances
    };
  });
};

export default authRoutes;
