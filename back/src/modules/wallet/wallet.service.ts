import { Currency, Prisma, PrismaClient, TransactionType } from '@prisma/client';
import { AppError } from '../shared/errors';

interface BalanceSnapshot {
  available: bigint;
  locked: bigint;
}

interface LockStakeInput {
  userId: string;
  currency: Currency;
  amountMinor: bigint;
  referenceType: string;
  referenceId: string;
}

interface SettlementInput {
  matchId: string;
  currency: Currency;
  stakeMinor: bigint;
  player1UserId: string;
  player2UserId: string;
  winnerUserId: string | null;
  rakeMinor: bigint;
  reason: string;
}

export class WalletService {
  constructor(private readonly prisma: PrismaClient) {}

  async getBalances(userId: string) {
    return this.prisma.userBalance.findMany({
      where: { userId },
      orderBy: { currency: 'asc' }
    });
  }

  async depositMock(params: {
    userId: string;
    currency: Currency;
    amountMinor: bigint;
    idempotencyKey?: string;
  }) {
    if (params.amountMinor <= BigInt(0)) {
      throw new AppError('Deposit amount must be positive', 400, 'INVALID_DEPOSIT_AMOUNT');
    }

    return this.prisma.$transaction(async (tx) => {
      if (params.idempotencyKey) {
        const existing = await tx.balanceTransaction.findUnique({
          where: { idempotencyKey: params.idempotencyKey }
        });

        if (existing) {
          return existing;
        }
      }

      const { balance, snapshot } = await this.getOrCreateBalance(tx, params.userId, params.currency);

      const updated = await tx.userBalance.update({
        where: { id: balance.id },
        data: {
          availableMinor: {
            increment: params.amountMinor
          }
        }
      });

      return tx.balanceTransaction.create({
        data: {
          userId: params.userId,
          currency: params.currency,
          type: TransactionType.DEPOSIT,
          status: 'COMPLETED',
          amountMinor: params.amountMinor,
          balanceBefore: snapshot.available,
          balanceAfter: updated.availableMinor,
          lockedBefore: snapshot.locked,
          lockedAfter: updated.lockedMinor,
          idempotencyKey: params.idempotencyKey,
          referenceType: 'MOCK_DEPOSIT'
        }
      });
    });
  }

  async lockStake(tx: Prisma.TransactionClient, input: LockStakeInput): Promise<void> {
    if (input.amountMinor <= BigInt(0)) {
      throw new AppError('Stake amount must be positive', 400, 'INVALID_STAKE_AMOUNT');
    }

    const { balance, snapshot } = await this.getOrCreateBalance(tx, input.userId, input.currency);
    if (snapshot.available < input.amountMinor) {
      throw new AppError('Insufficient balance for stake', 409, 'INSUFFICIENT_BALANCE');
    }

    const updated = await tx.userBalance.update({
      where: { id: balance.id },
      data: {
        availableMinor: {
          decrement: input.amountMinor
        },
        lockedMinor: {
          increment: input.amountMinor
        }
      }
    });

    await tx.balanceTransaction.create({
      data: {
        userId: input.userId,
        currency: input.currency,
        type: TransactionType.LOCK_STAKE,
        amountMinor: -input.amountMinor,
        balanceBefore: snapshot.available,
        balanceAfter: updated.availableMinor,
        lockedBefore: snapshot.locked,
        lockedAfter: updated.lockedMinor,
        referenceType: input.referenceType,
        referenceId: input.referenceId
      }
    });
  }

  async refundStake(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      currency: Currency;
      amountMinor: bigint;
      referenceType: string;
      referenceId: string;
    }
  ): Promise<void> {
    const balance = await tx.userBalance.findUnique({
      where: {
        userId_currency: {
          userId: params.userId,
          currency: params.currency
        }
      }
    });

    if (!balance || balance.lockedMinor < params.amountMinor) {
      throw new AppError('Insufficient locked balance to refund', 409, 'INSUFFICIENT_LOCKED_BALANCE');
    }

    const updated = await tx.userBalance.update({
      where: { id: balance.id },
      data: {
        lockedMinor: {
          decrement: params.amountMinor
        },
        availableMinor: {
          increment: params.amountMinor
        }
      }
    });

    await tx.balanceTransaction.create({
      data: {
        userId: params.userId,
        currency: params.currency,
        type: TransactionType.REFUND_STAKE,
        amountMinor: params.amountMinor,
        balanceBefore: balance.availableMinor,
        balanceAfter: updated.availableMinor,
        lockedBefore: balance.lockedMinor,
        lockedAfter: updated.lockedMinor,
        referenceType: params.referenceType,
        referenceId: params.referenceId
      }
    });
  }

  async settleTwoPlayerMatch(tx: Prisma.TransactionClient, input: SettlementInput): Promise<void> {
    const totalPot = input.stakeMinor * BigInt(2);

    await this.decreaseLocked(tx, input.player1UserId, input.currency, input.stakeMinor, input.matchId, input.reason);
    await this.decreaseLocked(tx, input.player2UserId, input.currency, input.stakeMinor, input.matchId, input.reason);

    if (!input.winnerUserId) {
      await this.creditAvailable(tx, {
        userId: input.player1UserId,
        currency: input.currency,
        amountMinor: input.stakeMinor,
        type: TransactionType.REFUND_STAKE,
        referenceId: input.matchId,
        metadata: { reason: input.reason, draw: true }
      });

      await this.creditAvailable(tx, {
        userId: input.player2UserId,
        currency: input.currency,
        amountMinor: input.stakeMinor,
        type: TransactionType.REFUND_STAKE,
        referenceId: input.matchId,
        metadata: { reason: input.reason, draw: true }
      });

      return;
    }

    const payout = totalPot - input.rakeMinor;
    await this.creditAvailable(tx, {
      userId: input.winnerUserId,
      currency: input.currency,
      amountMinor: payout,
      type: TransactionType.PAYOUT,
      referenceId: input.matchId,
      metadata: { reason: input.reason, rakeMinor: input.rakeMinor.toString() }
    });

    if (input.rakeMinor > BigInt(0)) {
      await tx.balanceTransaction.create({
        data: {
          userId: input.winnerUserId,
          currency: input.currency,
          type: TransactionType.FEE,
          amountMinor: -input.rakeMinor,
          balanceBefore: BigInt(0),
          balanceAfter: BigInt(0),
          lockedBefore: BigInt(0),
          lockedAfter: BigInt(0),
          referenceType: 'MATCH_RAKE',
          referenceId: input.matchId,
          metadata: {
            note: 'Accounting marker: rake deducted from payout'
          }
        }
      });
    }
  }

  private async getOrCreateBalance(
    tx: Prisma.TransactionClient,
    userId: string,
    currency: Currency
  ): Promise<{ balance: { id: string }; snapshot: BalanceSnapshot }> {
    const balance = await tx.userBalance.upsert({
      where: {
        userId_currency: {
          userId,
          currency
        }
      },
      update: {},
      create: {
        userId,
        currency,
        availableMinor: BigInt(0),
        lockedMinor: BigInt(0)
      }
    });

    return {
      balance: { id: balance.id },
      snapshot: {
        available: balance.availableMinor,
        locked: balance.lockedMinor
      }
    };
  }

  private async decreaseLocked(
    tx: Prisma.TransactionClient,
    userId: string,
    currency: Currency,
    amountMinor: bigint,
    matchId: string,
    reason: string
  ): Promise<void> {
    const balance = await tx.userBalance.findUnique({
      where: {
        userId_currency: {
          userId,
          currency
        }
      }
    });

    if (!balance || balance.lockedMinor < amountMinor) {
      throw new AppError('Insufficient locked balance for settlement', 409, 'INSUFFICIENT_LOCKED_BALANCE');
    }

    const updated = await tx.userBalance.update({
      where: { id: balance.id },
      data: {
        lockedMinor: {
          decrement: amountMinor
        }
      }
    });

    await tx.balanceTransaction.create({
      data: {
        userId,
        currency,
        type: TransactionType.LOCK_STAKE,
        amountMinor: BigInt(0),
        balanceBefore: balance.availableMinor,
        balanceAfter: updated.availableMinor,
        lockedBefore: balance.lockedMinor,
        lockedAfter: updated.lockedMinor,
        referenceType: 'MATCH_SETTLEMENT_LOCK_RELEASE',
        referenceId: matchId,
        metadata: {
          reason,
          releasedMinor: amountMinor.toString()
        }
      }
    });
  }

  private async creditAvailable(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      currency: Currency;
      amountMinor: bigint;
      type: TransactionType;
      referenceId: string;
      metadata: Prisma.InputJsonValue;
    }
  ): Promise<void> {
    const balance = await tx.userBalance.findUnique({
      where: {
        userId_currency: {
          userId: params.userId,
          currency: params.currency
        }
      }
    });

    if (!balance) {
      throw new AppError('Balance row is missing', 500, 'BALANCE_MISSING');
    }

    const updated = await tx.userBalance.update({
      where: { id: balance.id },
      data: {
        availableMinor: {
          increment: params.amountMinor
        }
      }
    });

    await tx.balanceTransaction.create({
      data: {
        userId: params.userId,
        currency: params.currency,
        type: params.type,
        amountMinor: params.amountMinor,
        balanceBefore: balance.availableMinor,
        balanceAfter: updated.availableMinor,
        lockedBefore: balance.lockedMinor,
        lockedAfter: updated.lockedMinor,
        referenceType: 'MATCH_SETTLEMENT',
        referenceId: params.referenceId,
        metadata: params.metadata
      }
    });
  }
}
