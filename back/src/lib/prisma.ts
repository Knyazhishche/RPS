import { PrismaClient } from '@prisma/client';

export function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: ['warn', 'error']
  });
}
