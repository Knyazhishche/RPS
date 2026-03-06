import crypto from 'crypto';

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function buildMoveCommitHash(move: string, salt: string): string {
  return sha256(`${move}:${salt}`);
}
