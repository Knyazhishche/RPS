import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

const loginSchema = z.object({
  initData: z.string().min(1)
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
