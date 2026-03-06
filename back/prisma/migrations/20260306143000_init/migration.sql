-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "LobbyStatus" AS ENUM ('WAITING', 'RUNNING', 'CLOSED');

-- CreateEnum
CREATE TYPE "LobbyVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ParticipantState" AS ENUM ('JOINED', 'LEFT', 'KICKED');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('TON', 'STARS');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('WAITING_COMMIT', 'WAITING_REVEAL', 'RESOLVED', 'CANCELED');

-- CreateEnum
CREATE TYPE "Move" AS ENUM ('ROCK', 'PAPER', 'SCISSORS');

-- CreateEnum
CREATE TYPE "MatchResult" AS ENUM ('PENDING', 'PLAYER1_WIN', 'PLAYER2_WIN', 'DRAW', 'CANCELED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'LOCK_STAKE', 'REFUND_STAKE', 'PAYOUT', 'FEE');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('TON', 'STARS');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'CONFIRMED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "photoUrl" TEXT,
    "languageCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lobby" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "status" "LobbyStatus" NOT NULL DEFAULT 'WAITING',
    "visibility" "LobbyVisibility" NOT NULL DEFAULT 'PUBLIC',
    "currency" "Currency" NOT NULL,
    "stakeMinor" BIGINT NOT NULL,
    "minPlayers" INTEGER NOT NULL DEFAULT 2,
    "maxPlayers" INTEGER NOT NULL DEFAULT 2,
    "autoStart" BOOLEAN NOT NULL DEFAULT true,
    "joinCode" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Lobby_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LobbyParticipant" (
    "id" TEXT NOT NULL,
    "lobbyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seatNo" INTEGER NOT NULL,
    "state" "ParticipantState" NOT NULL DEFAULT 'JOINED',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "LobbyParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "lobbyId" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'WAITING_COMMIT',
    "result" "MatchResult" NOT NULL DEFAULT 'PENDING',
    "currency" "Currency" NOT NULL,
    "stakeMinor" BIGINT NOT NULL,
    "potMinor" BIGINT NOT NULL,
    "rakeMinor" BIGINT NOT NULL DEFAULT 0,
    "winnerUserId" TEXT,
    "resolutionReason" TEXT,
    "commitDeadline" TIMESTAMP(3) NOT NULL,
    "revealDeadline" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchPlayer" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "commitHash" TEXT,
    "committedAt" TIMESTAMP(3),
    "revealMove" "Move",
    "revealSalt" TEXT,
    "revealedAt" TIMESTAMP(3),
    "forfeitReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBalance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "availableMinor" BIGINT NOT NULL DEFAULT 0,
    "lockedMinor" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BalanceTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'COMPLETED',
    "amountMinor" BIGINT NOT NULL,
    "balanceBefore" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "lockedBefore" BIGINT NOT NULL,
    "lockedAfter" BIGINT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "idempotencyKey" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "currency" "Currency" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "externalRequestId" TEXT,
    "externalTxHash" TEXT,
    "idempotencyKey" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenId_key" ON "Session"("tokenId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Lobby_publicId_key" ON "Lobby"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Lobby_joinCode_key" ON "Lobby"("joinCode");

-- CreateIndex
CREATE INDEX "Lobby_status_visibility_currency_stakeMinor_idx" ON "Lobby"("status", "visibility", "currency", "stakeMinor");

-- CreateIndex
CREATE INDEX "Lobby_hostUserId_idx" ON "Lobby"("hostUserId");

-- CreateIndex
CREATE INDEX "LobbyParticipant_lobbyId_state_idx" ON "LobbyParticipant"("lobbyId", "state");

-- CreateIndex
CREATE INDEX "LobbyParticipant_userId_state_idx" ON "LobbyParticipant"("userId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "LobbyParticipant_lobbyId_userId_key" ON "LobbyParticipant"("lobbyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "LobbyParticipant_lobbyId_seatNo_key" ON "LobbyParticipant"("lobbyId", "seatNo");

-- CreateIndex
CREATE INDEX "Match_lobbyId_status_idx" ON "Match"("lobbyId", "status");

-- CreateIndex
CREATE INDEX "Match_status_commitDeadline_idx" ON "Match"("status", "commitDeadline");

-- CreateIndex
CREATE INDEX "Match_status_revealDeadline_idx" ON "Match"("status", "revealDeadline");

-- CreateIndex
CREATE INDEX "MatchPlayer_matchId_idx" ON "MatchPlayer"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchPlayer_matchId_userId_key" ON "MatchPlayer"("matchId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchPlayer_matchId_position_key" ON "MatchPlayer"("matchId", "position");

-- CreateIndex
CREATE INDEX "UserBalance_currency_idx" ON "UserBalance"("currency");

-- CreateIndex
CREATE UNIQUE INDEX "UserBalance_userId_currency_key" ON "UserBalance"("userId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "BalanceTransaction_idempotencyKey_key" ON "BalanceTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BalanceTransaction_userId_createdAt_idx" ON "BalanceTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BalanceTransaction_referenceType_referenceId_idx" ON "BalanceTransaction"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_idempotencyKey_key" ON "PaymentRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentRequest_userId_provider_status_idx" ON "PaymentRequest"("userId", "provider", "status");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lobby" ADD CONSTRAINT "Lobby_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyParticipant" ADD CONSTRAINT "LobbyParticipant_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyParticipant" ADD CONSTRAINT "LobbyParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlayer" ADD CONSTRAINT "MatchPlayer_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlayer" ADD CONSTRAINT "MatchPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBalance" ADD CONSTRAINT "UserBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceTransaction" ADD CONSTRAINT "BalanceTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

