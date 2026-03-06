import { Currency, LobbyStatus, LobbyVisibility, Prisma, PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';
import { EventBus } from '../../lib/event-bus';
import { withSerializableRetry } from '../../lib/retry';
import { AppError } from '../shared/errors';
import { MatchService } from '../match/match.service';
import { WalletService } from '../wallet/wallet.service';

interface CreateLobbyInput {
  currency: Currency;
  stakeMinor: bigint;
  visibility: LobbyVisibility;
  autoStart: boolean;
  metadata?: Prisma.InputJsonValue;
}

interface AutoJoinInput {
  currency: Currency;
  stakeMinor: bigint;
}

interface JoinResult {
  lobby: Awaited<ReturnType<LobbyService['getLobbyById']>>;
  matchId: string | null;
}

const JOIN_CODE_LENGTH = 6;

export class LobbyService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly wallet: WalletService,
    private readonly matches: MatchService,
    private readonly eventBus: EventBus
  ) {}

  async createLobby(userId: string, input: CreateLobbyInput) {
    if (input.stakeMinor <= BigInt(0)) {
      throw new AppError('Stake amount must be positive', 400, 'INVALID_STAKE_AMOUNT');
    }

    const lobby = await withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const lobbyRow = await tx.lobby.create({
            data: {
              publicId: ulid(),
              hostUserId: userId,
              currency: input.currency,
              stakeMinor: input.stakeMinor,
              visibility: input.visibility,
              minPlayers: 2,
              maxPlayers: 2,
              autoStart: input.autoStart,
              metadata: input.metadata,
              joinCode: input.visibility === LobbyVisibility.PRIVATE ? this.generateJoinCode() : null
            }
          });

          await tx.lobbyParticipant.create({
            data: {
              lobbyId: lobbyRow.id,
              userId,
              seatNo: 1,
              state: 'JOINED'
            }
          });

          await this.wallet.lockStake(tx, {
            userId,
            currency: input.currency,
            amountMinor: input.stakeMinor,
            referenceType: 'LOBBY_STAKE_LOCK',
            referenceId: lobbyRow.id
          });

          return lobbyRow;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        }
      )
    );

    await this.eventBus.publish('lobby.created', {
      lobbyId: lobby.id,
      hostUserId: userId,
      currency: lobby.currency,
      stakeMinor: lobby.stakeMinor.toString(),
      visibility: lobby.visibility,
      happenedAt: new Date().toISOString()
    });

    return this.getLobbyById(lobby.id);
  }

  async getLobbyById(lobbyId: string) {
    const lobby = await this.prisma.lobby.findUnique({
      where: { id: lobbyId },
      include: {
        participants: {
          where: { state: 'JOINED' },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                telegramId: true
              }
            }
          },
          orderBy: { seatNo: 'asc' }
        },
        matches: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { players: true }
        }
      }
    });

    if (!lobby) {
      throw new AppError('Lobby not found', 404, 'LOBBY_NOT_FOUND');
    }

    return lobby;
  }

  async listLobbies(filters: {
    currency?: Currency;
    stakeMinor?: bigint;
    visibility?: LobbyVisibility;
    onlyJoinable?: boolean;
  }) {
    const lobbies = await this.prisma.lobby.findMany({
      where: {
        status: LobbyStatus.WAITING,
        visibility: filters.visibility,
        currency: filters.currency,
        stakeMinor: filters.stakeMinor,
        ...(filters.onlyJoinable
          ? {
              participants: {
                some: {
                  state: 'JOINED'
                }
              }
            }
          : {})
      },
      include: {
        participants: {
          where: { state: 'JOINED' },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true
              }
            }
          }
        }
      },
      orderBy: [{ stakeMinor: 'asc' }, { createdAt: 'asc' }]
    });

    return lobbies.filter((lobby) => lobby.participants.length < lobby.maxPlayers);
  }

  async joinLobby(userId: string, lobbyId: string, joinCode?: string): Promise<JoinResult> {
    return this.joinLobbyTx(userId, async (tx) => {
      const lobby = await this.getLobbyForJoin(tx, lobbyId);
      this.assertLobbyJoinable(lobby, userId, joinCode);
      return lobby.id;
    });
  }

  async autoJoin(userId: string, input: AutoJoinInput): Promise<JoinResult> {
    if (input.stakeMinor <= BigInt(0)) {
      throw new AppError('Stake amount must be positive', 400, 'INVALID_STAKE_AMOUNT');
    }

    return this.joinLobbyTx(userId, async (tx) => {
      const candidates = await tx.lobby.findMany({
        where: {
          status: LobbyStatus.WAITING,
          visibility: LobbyVisibility.PUBLIC,
          currency: input.currency,
          stakeMinor: input.stakeMinor
        },
        include: {
          participants: {
            where: {
              state: 'JOINED'
            }
          }
        },
        orderBy: [{ createdAt: 'asc' }],
        take: 20
      });

      const target = candidates.find(
        (candidate) =>
          candidate.participants.length < candidate.maxPlayers && !candidate.participants.some((part) => part.userId === userId)
      );

      if (!target) {
        throw new AppError('No available lobby for automatch', 404, 'AUTOJOIN_NOT_FOUND');
      }

      return target.id;
    });
  }

  async leaveLobby(userId: string, lobbyId: string) {
    const lobby = await withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const currentLobby = await tx.lobby.findUnique({
            where: { id: lobbyId },
            include: {
              participants: {
                where: { state: 'JOINED' },
                orderBy: { joinedAt: 'asc' }
              }
            }
          });

          if (!currentLobby) {
            throw new AppError('Lobby not found', 404, 'LOBBY_NOT_FOUND');
          }

          if (currentLobby.status !== LobbyStatus.WAITING) {
            throw new AppError('Cannot leave lobby after game started', 409, 'LOBBY_ALREADY_STARTED');
          }

          const participant = currentLobby.participants.find((item) => item.userId === userId);
          if (!participant) {
            throw new AppError('User is not in lobby', 409, 'USER_NOT_IN_LOBBY');
          }

          await tx.lobbyParticipant.delete({ where: { id: participant.id } });

          await this.wallet.refundStake(tx, {
            userId,
            currency: currentLobby.currency,
            amountMinor: currentLobby.stakeMinor,
            referenceType: 'LOBBY_LEAVE_REFUND',
            referenceId: currentLobby.id
          });

          const remainingParticipants = currentLobby.participants.filter((item) => item.userId !== userId);
          if (remainingParticipants.length === 0) {
            await tx.lobby.update({
              where: { id: currentLobby.id },
              data: {
                status: LobbyStatus.CLOSED,
                closedAt: new Date()
              }
            });
          } else if (currentLobby.hostUserId === userId) {
            const nextHost = remainingParticipants[0];
            if (!nextHost) {
              throw new AppError('Unable to assign new lobby host', 500, 'LOBBY_HOST_ASSIGNMENT_FAILED');
            }

            await tx.lobby.update({
              where: { id: currentLobby.id },
              data: {
                hostUserId: nextHost.userId
              }
            });
          }

          return currentLobby;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        }
      )
    );

    await this.eventBus.publish('lobby.left', {
      lobbyId: lobby.id,
      userId,
      happenedAt: new Date().toISOString()
    });

    return this.getLobbyById(lobby.id);
  }

  private async joinLobbyTx(
    userId: string,
    pickLobbyId: (tx: Prisma.TransactionClient) => Promise<string>
  ): Promise<JoinResult> {
    const result = await withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const lobbyId = await pickLobbyId(tx);
          const lobby = await this.getLobbyForJoin(tx, lobbyId);

          const occupiedSeats = new Set(lobby.participants.map((entry) => entry.seatNo));
          const seatNo = [1, 2].find((seat) => !occupiedSeats.has(seat));
          if (!seatNo) {
            throw new AppError('Lobby is full', 409, 'LOBBY_FULL');
          }

          const existing = await tx.lobbyParticipant.findUnique({
            where: {
              lobbyId_userId: {
                lobbyId: lobby.id,
                userId
              }
            }
          });

          if (existing?.state === 'JOINED') {
            return {
              lobbyId: lobby.id,
              matchId: null,
              joinedNow: false
            };
          }

          if (existing) {
            await tx.lobbyParticipant.update({
              where: { id: existing.id },
              data: {
                state: 'JOINED',
                seatNo,
                joinedAt: new Date(),
                leftAt: null
              }
            });
          } else {
            await tx.lobbyParticipant.create({
              data: {
                lobbyId: lobby.id,
                userId,
                state: 'JOINED',
                seatNo
              }
            });
          }

          await this.wallet.lockStake(tx, {
            userId,
            currency: lobby.currency,
            amountMinor: lobby.stakeMinor,
            referenceType: 'LOBBY_STAKE_LOCK',
            referenceId: lobby.id
          });

          const joinedCount = lobby.participants.length + 1;
          let matchId: string | null = null;
          if (joinedCount >= lobby.minPlayers && lobby.autoStart) {
            const match = await this.matches.createMatchForLobby(tx, lobby.id);
            matchId = match.id;
          }

          return {
            lobbyId: lobby.id,
            matchId,
            joinedNow: true
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        }
      )
    );

    if (result.joinedNow) {
      await this.eventBus.publish('lobby.joined', {
        lobbyId: result.lobbyId,
        userId,
        happenedAt: new Date().toISOString()
      });
    }

    if (result.matchId) {
      await this.eventBus.publish('lobby.started', {
        lobbyId: result.lobbyId,
        matchId: result.matchId,
        happenedAt: new Date().toISOString()
      });

      await this.eventBus.publish('game.match.started', {
        lobbyId: result.lobbyId,
        matchId: result.matchId,
        happenedAt: new Date().toISOString()
      });
    }

    return {
      lobby: await this.getLobbyById(result.lobbyId),
      matchId: result.matchId
    };
  }

  private assertLobbyJoinable(
    lobby: {
      id: string;
      status: LobbyStatus;
      visibility: LobbyVisibility;
      joinCode: string | null;
      maxPlayers: number;
      participants: Array<{ userId: string }>;
    },
    userId: string,
    joinCode?: string
  ): void {
    if (lobby.status !== LobbyStatus.WAITING) {
      throw new AppError('Lobby is not available', 409, 'LOBBY_NOT_AVAILABLE');
    }

    if (lobby.visibility === LobbyVisibility.PRIVATE && lobby.joinCode && joinCode !== lobby.joinCode) {
      throw new AppError('Invalid join code', 403, 'INVALID_JOIN_CODE');
    }

    if (lobby.participants.length >= lobby.maxPlayers && !lobby.participants.some((entry) => entry.userId === userId)) {
      throw new AppError('Lobby is full', 409, 'LOBBY_FULL');
    }
  }

  private async getLobbyForJoin(tx: Prisma.TransactionClient, lobbyId: string) {
    const lobby = await tx.lobby.findUnique({
      where: { id: lobbyId },
      include: {
        participants: {
          where: {
            state: 'JOINED'
          }
        }
      }
    });

    if (!lobby) {
      throw new AppError('Lobby not found', 404, 'LOBBY_NOT_FOUND');
    }

    return lobby;
  }

  private generateJoinCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < JOIN_CODE_LENGTH; i += 1) {
      const index = Math.floor(Math.random() * alphabet.length);
      out += alphabet[index];
    }

    return out;
  }
}
