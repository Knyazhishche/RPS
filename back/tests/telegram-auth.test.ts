import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { verifyTelegramInitData } from '../src/modules/auth/telegram-auth';

function buildInitData(botToken: string, authDate: number): string {
  const user = JSON.stringify({ id: 12345, first_name: 'Alice' });
  const params = new URLSearchParams();
  params.set('auth_date', String(authDate));
  params.set('user', user);
  params.set('query_id', 'AAH123');

  const lines = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort((a, b) => a.localeCompare(b))
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secret).update(lines).digest('hex');

  params.set('hash', hash);
  return params.toString();
}

describe('verifyTelegramInitData', () => {
  it('accepts valid initData', () => {
    const botToken = '123456:token';
    const authDate = Math.floor(Date.now() / 1000);
    const initData = buildInitData(botToken, authDate);

    const payload = verifyTelegramInitData(initData, botToken, 120);
    expect(payload.user.id).toBe(12345);
  });

  it('rejects expired initData', () => {
    const botToken = '123456:token';
    const authDate = Math.floor(Date.now() / 1000) - 3600;
    const initData = buildInitData(botToken, authDate);

    expect(() => verifyTelegramInitData(initData, botToken, 60)).toThrowError();
  });
});
