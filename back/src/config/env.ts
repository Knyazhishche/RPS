import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1),
  RABBITMQ_URL: z.string().min(1),
  RABBITMQ_EXCHANGE: z.string().min(1).default('rps.events'),

  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_SEC: z.coerce.number().int().positive().default(60 * 60 * 24 * 7),

  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_AUTH_MAX_AGE_SEC: z.coerce.number().int().positive().default(60 * 60 * 24),

  COMMIT_PHASE_SEC: z.coerce.number().int().positive().default(30),
  REVEAL_PHASE_SEC: z.coerce.number().int().positive().default(30),
  RAKE_BPS: z.coerce.number().int().min(0).max(10_000).default(0),
  WORKER_TICK_MS: z.coerce.number().int().positive().default(5000)
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new Error(`Invalid environment variables: ${issues}`);
}

export const env = parsed.data;
export type Env = typeof env;
