import { Move, MatchResult } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { compareMoves, resolveRound } from '../src/modules/match/game-logic';

describe('compareMoves', () => {
  it('returns draw when moves are equal', () => {
    expect(compareMoves(Move.ROCK, Move.ROCK)).toBe(0);
  });

  it('returns win for first player when first beats second', () => {
    expect(compareMoves(Move.ROCK, Move.SCISSORS)).toBe(1);
    expect(compareMoves(Move.PAPER, Move.ROCK)).toBe(1);
    expect(compareMoves(Move.SCISSORS, Move.PAPER)).toBe(1);
  });
});

describe('resolveRound', () => {
  it('resolves standard winner', () => {
    const result = resolveRound(
      {
        userId: 'u1',
        position: 1,
        move: Move.PAPER,
        committed: true,
        hasForfeit: false
      },
      {
        userId: 'u2',
        position: 2,
        move: Move.ROCK,
        committed: true,
        hasForfeit: false
      }
    );

    expect(result.result).toBe(MatchResult.PLAYER1_WIN);
    expect(result.winnerPosition).toBe(1);
  });

  it('resolves draw when both players forfeit', () => {
    const result = resolveRound(
      {
        userId: 'u1',
        position: 1,
        move: null,
        committed: false,
        hasForfeit: false
      },
      {
        userId: 'u2',
        position: 2,
        move: null,
        committed: false,
        hasForfeit: false
      }
    );

    expect(result.result).toBe(MatchResult.DRAW);
    expect(result.winnerPosition).toBeNull();
  });

  it('resolves forfeit winner', () => {
    const result = resolveRound(
      {
        userId: 'u1',
        position: 1,
        move: Move.ROCK,
        committed: true,
        hasForfeit: false
      },
      {
        userId: 'u2',
        position: 2,
        move: null,
        committed: true,
        hasForfeit: true
      }
    );

    expect(result.result).toBe(MatchResult.PLAYER1_WIN);
    expect(result.winnerPosition).toBe(1);
  });
});
