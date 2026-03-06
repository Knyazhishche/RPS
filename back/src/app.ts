import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { env } from './config/env';
import { EventBus } from './lib/event-bus';
import { createLogger } from './lib/logger';
import { createPrismaClient } from './lib/prisma';
import authRoutes from './modules/auth/auth.routes';
import lobbyRoutes from './modules/lobby/lobby.routes';
import matchRoutes from './modules/match/match.routes';
import { AppError } from './modules/shared/errors';
import walletRoutes from './modules/wallet/wallet.routes';
import { AppServices } from './services';
import { serializeBigInt } from './utils/serialize';
import { AuthService } from './modules/auth/auth.service';
import { WalletService } from './modules/wallet/wallet.service';
import { MatchService } from './modules/match/match.service';
import { LobbyService } from './modules/lobby/lobby.service';

export async function buildApp() {
  const app = Fastify({
    logger: createLogger('api')
  });

  const prisma = createPrismaClient();
  const eventBus = new EventBus(env.RABBITMQ_URL, env.RABBITMQ_EXCHANGE);
  await eventBus.connect();

  const walletService = new WalletService(prisma);
  const matchService = new MatchService(prisma, walletService, eventBus, env);
  const authService = new AuthService(prisma, env);
  const lobbyService = new LobbyService(prisma, walletService, matchService, eventBus);

  const services: AppServices = {
    auth: authService,
    wallet: walletService,
    match: matchService,
    lobby: lobbyService
  };

  app.decorate('env', env);
  app.decorate('prisma', prisma);
  app.decorate('eventBus', eventBus);
  app.decorate('services', services);

  await app.register(sensible);
  await app.register(helmet, {
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false
  });
  await app.register(cors, {
    origin: true,
    credentials: true
  });
  await app.register(jwt, {
    secret: env.JWT_SECRET
  });

  app.decorate('authenticate', async (request) => {
    await request.jwtVerify();

    const payload = request.user as { sub?: string; sid?: string };
    if (!payload.sub || !payload.sid) {
      throw new AppError('Invalid auth token payload', 401, 'INVALID_TOKEN_PAYLOAD');
    }

    const session = await app.prisma.session.findUnique({
      where: {
        tokenId: payload.sid
      }
    });

    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw new AppError('Session is invalid or expired', 401, 'SESSION_INVALID');
    }

    const user = await app.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new AppError('User not found', 401, 'USER_NOT_FOUND');
    }

    request.authUser = user;
  });

  app.addHook('preSerialization', async (_request, _reply, payload) => {
    return serializeBigInt(payload);
  });

  app.get('/healthz', async () => ({
    status: 'ok',
    service: 'rps-api',
    time: new Date().toISOString()
  }));

  app.get('/readyz', async () => {
    await app.prisma.$queryRaw`SELECT 1`;
    return {
      status: 'ready',
      service: 'rps-api',
      time: new Date().toISOString()
    };
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(walletRoutes, { prefix: '/api/wallet' });
  await app.register(lobbyRoutes, { prefix: '/api/lobbies' });
  await app.register(matchRoutes, { prefix: '/api/matches' });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        details: error.flatten()
      });
    }

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      request.log.error({ error }, 'Database error');
      return reply.status(409).send({
        error: 'DATABASE_ERROR',
        code: error.code,
        message: 'Database request failed'
      });
    }

    request.log.error({ error }, 'Unhandled error');
    return reply.status(500).send({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Unexpected server error'
    });
  });

  app.addHook('onClose', async () => {
    await eventBus.close();
    await prisma.$disconnect();
  });

  return app;
}
