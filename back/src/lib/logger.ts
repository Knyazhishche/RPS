import pino from 'pino';
import { env } from '../config/env';

export function createLogger(name: string) {
  return pino({
    level: env.LOG_LEVEL,
    name,
    transport:
      env.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: {
              translateTime: 'SYS:standard',
              colorize: true
            }
          }
        : undefined
  });
}
