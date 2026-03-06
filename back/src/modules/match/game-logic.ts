import { MatchResult, Move } from '@prisma/client';

interface EvaluatedPlayer {
  userId: string;
  position: number;
  move: Move | null;
  committed: boolean;
  hasForfeit: boolean;
}

export interface RoundResolution {
  result: MatchResult;
  winnerPosition: number | null;
  reason: string;
}

const WIN_MAP: Record<Move, Move> = {
  ROCK: Move.SCISSORS,
  PAPER: Move.ROCK,
  SCISSORS: Move.PAPER
};

export function compareMoves(first: Move, second: Move): number {
  if (first === second) {
    return 0;
  }

  return WIN_MAP[first] === second ? 1 : -1;
}

export function resolveRound(player1: EvaluatedPlayer, player2: EvaluatedPlayer): RoundResolution {
  const p1ValidReveal = Boolean(player1.move) && !player1.hasForfeit;
  const p2ValidReveal = Boolean(player2.move) && !player2.hasForfeit;

  if (p1ValidReveal && p2ValidReveal) {
    const comparison = compareMoves(player1.move as Move, player2.move as Move);
    if (comparison === 0) {
      return {
        result: MatchResult.DRAW,
        winnerPosition: null,
        reason: 'DRAW'
      };
    }

    return comparison > 0
      ? { result: MatchResult.PLAYER1_WIN, winnerPosition: player1.position, reason: 'NORMAL_WIN' }
      : { result: MatchResult.PLAYER2_WIN, winnerPosition: player2.position, reason: 'NORMAL_WIN' };
  }

  if (p1ValidReveal && !p2ValidReveal) {
    return {
      result: MatchResult.PLAYER1_WIN,
      winnerPosition: player1.position,
      reason: 'FORFEIT_WIN'
    };
  }

  if (p2ValidReveal && !p1ValidReveal) {
    return {
      result: MatchResult.PLAYER2_WIN,
      winnerPosition: player2.position,
      reason: 'FORFEIT_WIN'
    };
  }

  if (player1.committed && !player2.committed) {
    return {
      result: MatchResult.PLAYER1_WIN,
      winnerPosition: player1.position,
      reason: 'COMMIT_FORFEIT_WIN'
    };
  }

  if (player2.committed && !player1.committed) {
    return {
      result: MatchResult.PLAYER2_WIN,
      winnerPosition: player2.position,
      reason: 'COMMIT_FORFEIT_WIN'
    };
  }

  return {
    result: MatchResult.DRAW,
    winnerPosition: null,
    reason: 'BOTH_FORFEIT_OR_TIMEOUT'
  };
}
