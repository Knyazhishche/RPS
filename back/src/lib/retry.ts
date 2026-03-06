import { Prisma } from '@prisma/client';

const RETRYABLE_CODES = new Set(['P2034']);

export async function withSerializableRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      const isRetryable = error instanceof Prisma.PrismaClientKnownRequestError && RETRYABLE_CODES.has(error.code);
      if (!isRetryable || attempt >= maxRetries) {
        throw error;
      }

      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, attempt * 50));
    }
  }
}
