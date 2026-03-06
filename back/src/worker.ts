import { env } from './config/env';
import { EventBus } from './lib/event-bus';
import { createLogger } from './lib/logger';
import { createPrismaClient } from './lib/prisma';
import { MatchService } from './modules/match/match.service';
import { WalletService } from './modules/wallet/wallet.service';

async function main() {
  const logger = createLogger('worker');
  const prisma = createPrismaClient();
  const eventBus = new EventBus(env.RABBITMQ_URL, env.RABBITMQ_EXCHANGE);

  await eventBus.connect();

  const walletService = new WalletService(prisma);
  const matchService = new MatchService(prisma, walletService, eventBus, env);

  await eventBus.subscribe('rps.worker.events', ['lobby.*', 'game.*', 'payment.*'], async (routingKey, payload) => {
    logger.debug({ routingKey, payload }, 'Consumed event');
  });

  logger.info('Worker started');

  const interval = setInterval(async () => {
    try {
      const resolved = await matchService.resolveExpiredMatches();
      if (resolved > 0) {
        logger.info({ resolved }, 'Resolved expired matches');
      }
    } catch (error) {
      logger.error({ error }, 'Failed to process expired matches');
    }
  }, env.WORKER_TICK_MS);

  const shutdown = async (signal: string) => {
    clearInterval(interval);
    logger.info({ signal }, 'Shutting down worker');
    await eventBus.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
