# RPS Backend (Telegram Mini App, TON/Stars)

Production-ready backend для игры `Камень-Ножницы-Бумага`:
- `Node.js + TypeScript + Fastify`
- `Prisma + PostgreSQL`
- `RabbitMQ` (event bus + worker)
- Telegram Mini App auth (`initData` verification)
- Лобби-механика в стиле онлайн-покера (создание столов, вход, auto-join)
- Ставки в `TON`/`Stars` (балансы, lock/refund/payout)
- Fair-play commit-reveal схема

## Быстрый старт

1. Скопировать env:
```bash
cp .env.example .env
```

2. Поднять сервисы:
```bash
docker compose up --build
```

3. Проверить API:
```bash
curl http://localhost:3000/healthz
```

## Локальная разработка

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:migrate
npm run dev
npm run dev:worker
```

## Основные ENV

- `DATABASE_URL` - PostgreSQL DSN
- `RABBITMQ_URL` - RabbitMQ DSN
- `JWT_SECRET` - secret для access token
- `TELEGRAM_BOT_TOKEN` - токен Telegram бота
- `COMMIT_PHASE_SEC` - длительность commit фазы
- `REVEAL_PHASE_SEC` - длительность reveal фазы
- `RAKE_BPS` - рейк в bps (например `200` = 2%)

## API (кратко)

### Auth
- `POST /api/auth/telegram`
  - body: `{ "initData": "..." }`
  - response: `{ accessToken, user, expiresAt }`
- `GET /api/auth/me` (Bearer)

### Wallet
- `GET /api/wallet/balances` (Bearer)
- `POST /api/wallet/deposit/mock` (Bearer)
  - body: `{ "currency": "TON"|"STARS", "amountMinor": "1000000" }`

### Lobby
- `POST /api/lobbies` (Bearer)
  - body: `{ "currency": "TON", "stakeMinor": "1000", "visibility": "PUBLIC"|"PRIVATE", "autoStart": true }`
- `GET /api/lobbies` (Bearer)
- `GET /api/lobbies/:lobbyId` (Bearer)
- `POST /api/lobbies/:lobbyId/join` (Bearer)
- `POST /api/lobbies/auto-join` (Bearer)
- `POST /api/lobbies/:lobbyId/leave` (Bearer)

### Match
- `GET /api/matches/:matchId` (Bearer)
- `POST /api/matches/:matchId/commit` (Bearer)
  - body: `{ "commitHash": "<sha256(move:salt)>" }`
- `POST /api/matches/:matchId/reveal` (Bearer)
  - body: `{ "move": "ROCK|PAPER|SCISSORS", "salt": "random-salt" }`

## Event Bus (RabbitMQ)

Exchange: `rps.events` (`topic`)

Routing keys:
- `lobby.created`, `lobby.joined`, `lobby.left`, `lobby.started`, `lobby.closed`
- `game.match.started`, `game.commit.received`, `game.reveal.phase.started`, `game.reveal.received`, `game.match.resolved`
- `payment.deposit.mocked`

Worker queue: `rps.worker.events`

## Fair-play (commit-reveal)

1. Оба игрока отправляют hash: `sha256("MOVE:SALT")`
2. После commit-фазы открывается reveal-фаза
3. Игроки отправляют `move + salt`, backend валидирует hash
4. При таймаутах/невалидном reveal - forfeit логика
5. Балансы рассчитываются атомарно в DB-транзакции

## TON/Stars интеграция

В этом каркасе реализована production-ready финансовая модель (ledger, lock/payout/refund, idempotency). Для подключения реального процессинга TON/Stars:
1. Добавить provider-адаптеры для подтверждения on-chain/Stars платежей.
2. Вызывать подтверждение в `PaymentRequest` workflow.
3. Обновлять балансы только после подтверждения провайдера.

