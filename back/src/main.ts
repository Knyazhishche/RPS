import { buildApp } from './app';
import { env } from './config/env';

async function main() {
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down API server');
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  await app.listen({
    port: env.PORT,
    host: env.HOST
  });

  app.log.info({ host: env.HOST, port: env.PORT }, 'API server started');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
