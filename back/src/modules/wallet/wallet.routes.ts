import { FastifyPluginAsync } from 'fastify';
import { Currency } from '@prisma/client';
import { z } from 'zod';

const depositSchema = z.object({
  currency: z.nativeEnum(Currency),
  amountMinor: z.coerce.bigint().positive(),
  idempotencyKey: z.string().min(8).max(128).optional()
});

const walletRoutes: FastifyPluginAsync = async (app) => {
  app.get('/balances', { preHandler: app.authenticate }, async (request) => {
    return app.services.wallet.getBalances(request.authUser.id);
  });

  app.post('/deposit/mock', { preHandler: app.authenticate }, async (request) => {
    const body = depositSchema.parse(request.body);
    const transaction = await app.services.wallet.depositMock({
      userId: request.authUser.id,
      currency: body.currency,
      amountMinor: body.amountMinor,
      idempotencyKey: body.idempotencyKey
    });

    await app.eventBus.publish('payment.deposit.mocked', {
      userId: request.authUser.id,
      currency: body.currency,
      amountMinor: body.amountMinor.toString(),
      transactionId: transaction.id,
      happenedAt: new Date().toISOString()
    });

    return transaction;
  });
};

export default walletRoutes;
