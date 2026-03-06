import {
  Currency,
  Lobby,
  Match,
  MatchPlayer,
  MatchResult,
  MatchStatus,
  Move,
  Prisma,
  PrismaClient
} from '@prisma/client';
import { Env } from '../../config/env';
import { EventBus } from '../../lib/event-bus';
import { withSerializableRetry } from '../../lib/retry';
import { buildMoveCommitHash } from '../../utils/hash';
import { AppError } from '../shared/errors';
import { WalletService } from '../wallet/wallet.service';
import { resolveRound } from './game-logic';

interface EventDraft {
  key: string;
  payload: Record<string, unknown>;
}

type MatchWithPlayers = Match & { players: MatchPlayer[]; lobby: Lobby };

export class MatchService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly wallet: WalletService,
    private readonly eventBus: EventBus,
    private readonly env: Env
  ) {}

  async createMatchForLobby(tx: Prisma.TransactionClient, lobbyId: string): Promise<MatchWithPlayers> {
    const activeMatch = await tx.match.findFirst({
      where: {
        lobbyId,
        status: {
          in: [MatchStatus.WAITING_COMMIT, MatchStatus.WAITING_REVEAL]
        }
      },
      include: {
        players: true,
        lobby: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (activeMatch) {
      return activeMatch;
    }

    const lobby = await tx.lobby.findUnique({
      where: { id: lobbyId },
      include: {
        participants: {
          where: { state: 'JOINED' },
          orderBy: { seatNo: 'asc' }
        }
      }
    });

    if (!lobby) {
      throw new AppError('Lobby not found', 404, 'LOBBY_NOT_FOUND');
    }

    if (lobby.participants.length < lobby.minPlayers) {
      throw new AppError('Not enough players to start match', 409, 'NOT_ENOUGH_PLAYERS');
    }

    const players = lobby.participants.slice(0, 2);
    if (players.length !== 2) {
      throw new AppError('This backend currently supports exactly 2 players per match', 400, 'UNSUPPORTED_TABLE_SIZE');
    }

    const now = new Date();
    const commitDeadline = new Date(now.getTime() + this.env.COMMIT_PHASE_SEC * 1000);

    const match = await tx.match.create({
      data: {
        lobbyId: lobby.id,
        status: MatchStatus.WAITING_COMMIT,
        result: MatchResult.PENDING,
        currency: lobby.currency,
        stakeMinor: lobby.stakeMinor,
        potMinor: lobby.stakeMinor * BigInt(2),
        startedAt: now,
        commitDeadline,
        players: {
          create: players.map((participant, index) => ({
            userId: participant.userId,
            position: index + 1
          }))
        }
      },
      include: {
        players: true,
        lobby: true
      }
    });

    await tx.lobby.update({
      where: { id: lobby.id },
      data: {
        status: 'RUNNING'
      }
    });

    return match;
  }

  async commitMove(params: { userId: string; matchId: string; commitHash: string }): Promise<MatchWithPlayers> {
    const events: EventDraft[] = [];

    const result = await withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const match = await this.getMatchForUpdate(tx, params.matchId);
          this.assertPlayerIsInMatch(match, params.userId);

          if (match.status === MatchStatus.RESOLVED || match.status === MatchStatus.CANCELED) {
            throw new AppError('Match already resolved', 409, 'MATCH_ALREADY_RESOLVED');
          }

          if (match.status !== MatchStatus.WAITING_COMMIT) {
            throw new AppError('Commit phase is closed', 409, 'COMMIT_PHASE_CLOSED');
          }

          const now = new Date();
          if (now > match.commitDeadline) {
            return this.resolveMatchTx(tx, match.id, 'COMMIT_TIMEOUT');
          }

          const player = match.players.find((entry) => entry.userId === params.userId);
          if (!player) {
            throw new AppError('Player is not in match', 403, 'MATCH_ACCESS_DENIED');
          }

          if (player.commitHash) {
            throw new AppError('Move already committed', 409, 'MOVE_ALREADY_COMMITTED');
          }

          await tx.matchPlayer.update({
            where: { id: player.id },
            data: {
              commitHash: params.commitHash,
              committedAt: now
            }
          });

          events.push({
            key: 'game.commit.received',
            payload: {
              matchId: match.id,
              userId: params.userId,
              happenedAt: now.toISOString()
            }
          });

          const refreshed = await this.getMatchForUpdate(tx, match.id);
          const allCommitted = refreshed.players.every((entry) => Boolean(entry.commitHash));

          if (allCommitted) {
            const revealDeadline = new Date(now.getTime() + this.env.REVEAL_PHASE_SEC * 1000);
            await tx.match.update({
              where: { id: refreshed.id },
              data: {
                status: MatchStatus.WAITING_REVEAL,
                revealDeadline
              }
            });

            events.push({
              key: 'game.reveal.phase.started',
              payload: {
                matchId: refreshed.id,
                revealDeadline: revealDeadline.toISOString(),
                happenedAt: now.toISOString()
              }
            });
          }

          return this.getMatchForUpdate(tx, match.id);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        }
      )
    );

    for (const event of events) {
      await this.eventBus.publish(event.key, event.payload);
    }

    return result;
  }

  async revealMove(params: { userId: string; matchId: string; move: Move; salt: string }): Promise<MatchWithPlayers> {
    const events: EventDraft[] = [];

    const result = await withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const match = await this.getMatchForUpdate(tx, params.matchId);
          this.assertPlayerIsInMatch(match, params.userId);

          if (match.status === MatchStatus.RESOLVED || match.status === MatchStatus.CANCELED) {
            throw new AppError('Match already resolved', 409, 'MATCH_ALREADY_RESOLVED');
          }

          if (match.status !== MatchStatus.WAITING_REVEAL) {
            throw new AppError('Reveal phase is not active', 409, 'REVEAL_PHASE_NOT_ACTIVE');
          }

          const now = new Date();
          if (match.revealDeadline && now > match.revealDeadline) {
            return this.resolveMatchTx(tx, match.id, 'REVEAL_TIMEOUT');
          }

          const player = match.players.find((entry) => entry.userId === params.userId);
          if (!player) {
            throw new AppError('Player is not in match', 403, 'MATCH_ACCESS_DENIED');
          }

          if (player.revealMove) {
            throw new AppError('Move already revealed', 409, 'MOVE_ALREADY_REVEALED');
          }

          if (!player.commitHash) {
            throw new AppError('Commit hash missing for player', 409, 'COMMIT_REQUIRED');
          }

          const computedHash = buildMoveCommitHash(params.move, params.salt);
          const isValidReveal = computedHash === player.commitHash;

          await tx.matchPlayer.update({
            where: { id: player.id },
            data: {
              revealedAt: now,
              revealMove: isValidReveal ? params.move : null,
              revealSalt: isValidReveal ? params.salt : null,
              forfeitReason: isValidReveal ? null : 'INVALID_REVEAL'
            }
          });

          events.push({
            key: 'game.reveal.received',
            payload: {
              matchId: match.id,
              userId: params.userId,
              valid: isValidReveal,
              happenedAt: now.toISOString()
            }
          });

          const refreshed = await this.getMatchForUpdate(tx, match.id);
          const allRevealedOrForfeit = refreshed.players.every(
            (entry) => Boolean(entry.revealMove) || Boolean(entry.forfeitReason)
          );

          if (allRevealedOrForfeit) {
            return this.resolveMatchTx(tx, refreshed.id, 'REVEAL_COMPLETED');
          }

          return refreshed;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        }
      )
    );

    for (const event of events) {
      await this.eventBus.publish(event.key, event.payload);
    }

    return result;
  }

  async resolveExpiredMatches(limit = 100): Promise<number> {
    const now = new Date();
    const expired = await this.prisma.match.findMany({
      where: {
        OR: [
          {
            status: MatchStatus.WAITING_COMMIT,
            commitDeadline: { lte: now }
          },
          {
            status: MatchStatus.WAITING_REVEAL,
            revealDeadline: { lte: now }
          }
        ]
      },
      select: { id: true },
      take: limit
    });

    let resolvedCount = 0;
    for (const entry of expired) {
      try {
        await withSerializableRetry(() =>
          this.prisma.$transaction(
            async (tx) => {
              await this.resolveMatchTx(tx, entry.id, 'WORKER_TIMEOUT');
            },
            {
              isolationLevel: Prisma.TransactionIsolationLevel.Serializable
            }
          )
        );
        resolvedCount += 1;
      } catch (error) {
        // Match could be already resolved in another process.
        if (!(error instanceof AppError && error.code === 'MATCH_ALREADY_RESOLVED')) {
          throw error;
        }
      }
    }

    return resolvedCount;
  }

  async getMatchById(matchId: string, userId?: string): Promise<MatchWithPlayers> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        players: true,
        lobby: true
      }
    });

    if (!match) {
      throw new AppError('Match not found', 404, 'MATCH_NOT_FOUND');
    }

    if (userId && !match.players.some((player) => player.userId === userId)) {
      throw new AppError('Forbidden', 403, 'MATCH_ACCESS_DENIED');
    }

    return match;
  }

  private async resolveMatchTx(
    tx: Prisma.TransactionClient,
    matchId: string,
    reason: string
  ): Promise<MatchWithPlayers> {
    const match = await this.getMatchForUpdate(tx, matchId);
    if (match.status === MatchStatus.RESOLVED || match.status === MatchStatus.CANCELED) {
      throw new AppError('Match already resolved', 409, 'MATCH_ALREADY_RESOLVED');
    }

    const [player1, player2] = [...match.players].sort((a, b) => a.position - b.position);
    if (!player1 || !player2) {
      throw new AppError('Match players are missing', 500, 'MATCH_PLAYERS_MISSING');
    }

    const resolution = resolveRound(
      {
        userId: player1.userId,
        position: player1.position,
        move: player1.revealMove,
        committed: Boolean(player1.commitHash),
        hasForfeit: Boolean(player1.forfeitReason)
      },
      {
        userId: player2.userId,
        position: player2.position,
        move: player2.revealMove,
        committed: Boolean(player2.commitHash),
        hasForfeit: Boolean(player2.forfeitReason)
      }
    );

    const winnerUserId =
      resolution.winnerPosition === player1.position
        ? player1.userId
        : resolution.winnerPosition === player2.position
          ? player2.userId
          : null;

    const rakeMinor = winnerUserId
      ? (match.potMinor * BigInt(this.env.RAKE_BPS)) / BigInt(10_000)
      : BigInt(0);

    await this.wallet.settleTwoPlayerMatch(tx, {
      matchId: match.id,
      currency: match.currency as Currency,
      stakeMinor: match.stakeMinor,
      player1UserId: player1.userId,
      player2UserId: player2.userId,
      winnerUserId,
      rakeMinor,
      reason: `${reason}:${resolution.reason}`
    });

    await tx.match.update({
      where: { id: match.id },
      data: {
        status: MatchStatus.RESOLVED,
        result: resolution.result,
        winnerUserId,
        rakeMinor,
        resolvedAt: new Date(),
        resolutionReason: `${reason}:${resolution.reason}`
      }
    });

    await tx.lobby.update({
      where: { id: match.lobbyId },
      data: {
        status: 'CLOSED',
        closedAt: new Date()
      }
    });

    await tx.lobbyParticipant.updateMany({
      where: {
        lobbyId: match.lobbyId,
        state: 'JOINED'
      },
      data: {
        state: 'LEFT',
        leftAt: new Date()
      }
    });

    const resolvedMatch = await this.getMatchForUpdate(tx, match.id);

    await this.eventBus.publish('game.match.resolved', {
      matchId: resolvedMatch.id,
      lobbyId: resolvedMatch.lobbyId,
      result: resolvedMatch.result,
      winnerUserId: resolvedMatch.winnerUserId,
      reason: resolvedMatch.resolutionReason,
      happenedAt: new Date().toISOString()
    });

    await this.eventBus.publish('lobby.closed', {
      lobbyId: resolvedMatch.lobbyId,
      reason: 'MATCH_FINISHED',
      happenedAt: new Date().toISOString()
    });

    return resolvedMatch;
  }

  private async getMatchForUpdate(tx: Prisma.TransactionClient, matchId: string): Promise<MatchWithPlayers> {
    const match = await tx.match.findUnique({
      where: { id: matchId },
      include: {
        players: true,
        lobby: true
      }
    });

    if (!match) {
      throw new AppError('Match not found', 404, 'MATCH_NOT_FOUND');
    }

    return match;
  }

  private assertPlayerIsInMatch(match: MatchWithPlayers, userId: string): void {
    const player = match.players.find((entry) => entry.userId === userId);
    if (!player) {
      throw new AppError('Player is not in this match', 403, 'MATCH_ACCESS_DENIED');
    }
  }
}
