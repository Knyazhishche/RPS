import crypto from 'crypto';
import { AppError } from '../shared/errors';

export interface TelegramUserData {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
  language_code?: string;
}

export interface TelegramInitData {
  authDate: number;
  queryId?: string;
  user: TelegramUserData;
  raw: string;
}

function buildDataCheckString(params: URLSearchParams): string {
  const pairs: string[] = [];

  for (const [key, value] of params.entries()) {
    if (key === 'hash') {
      continue;
    }

    pairs.push(`${key}=${value}`);
  }

  pairs.sort((a, b) => a.localeCompare(b));
  return pairs.join('\n');
}

function computeHash(initData: string, botToken: string): string {
  const params = new URLSearchParams(initData);
  const dataCheckString = buildDataCheckString(params);
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  return crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
}

export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds: number
): TelegramInitData {
  if (!initData) {
    throw new AppError('initData is required', 400, 'TELEGRAM_INIT_DATA_REQUIRED');
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) {
    throw new AppError('initData hash is missing', 401, 'TELEGRAM_HASH_MISSING');
  }

  const expectedHash = computeHash(initData, botToken);
  if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash))) {
    throw new AppError('Invalid Telegram signature', 401, 'TELEGRAM_INVALID_SIGNATURE');
  }

  const authDateRaw = params.get('auth_date');
  const userRaw = params.get('user');
  if (!authDateRaw || !userRaw) {
    throw new AppError('Invalid Telegram initData payload', 401, 'TELEGRAM_INVALID_PAYLOAD');
  }

  const authDate = Number(authDateRaw);
  if (!Number.isInteger(authDate)) {
    throw new AppError('Invalid auth_date in initData', 401, 'TELEGRAM_INVALID_AUTH_DATE');
  }

  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > maxAgeSeconds) {
    throw new AppError('Telegram auth data is expired', 401, 'TELEGRAM_AUTH_EXPIRED');
  }

  let user: TelegramUserData;
  try {
    user = JSON.parse(userRaw) as TelegramUserData;
  } catch {
    throw new AppError('Invalid user payload in initData', 401, 'TELEGRAM_INVALID_USER');
  }

  if (!user.id || !Number.isInteger(user.id)) {
    throw new AppError('Telegram user id is invalid', 401, 'TELEGRAM_INVALID_USER_ID');
  }

  return {
    authDate,
    queryId: params.get('query_id') ?? undefined,
    user,
    raw: initData
  };
}
