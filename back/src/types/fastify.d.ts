import 'fastify';
import { User } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { EventBus } from '../lib/event-bus';
import { AppServices } from '../services';
import { Env } from '../config/env';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    eventBus: EventBus;
    services: AppServices;
    env: Env;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    authUser: User;
  }
}
