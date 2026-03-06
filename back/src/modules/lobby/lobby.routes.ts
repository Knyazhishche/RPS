import { Currency, LobbyVisibility } from '@prisma/client';
import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

const createLobbySchema = z.object({
  currency: z.nativeEnum(Currency),
  stakeMinor: z.coerce.bigint().positive(),
  visibility: z.nativeEnum(LobbyVisibility).default(LobbyVisibility.PUBLIC),
  autoStart: z.boolean().default(true),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const listLobbiesSchema = z.object({
  currency: z.nativeEnum(Currency).optional(),
  stakeMinor: z.coerce.bigint().optional(),
  visibility: z.nativeEnum(LobbyVisibility).optional(),
  onlyJoinable: z
    .union([z.string(), z.boolean()])
    .transform((value) => {
      if (typeof value === 'boolean') {
        return value;
      }

      return value === 'true' || value === '1';
    })
    .optional()
});

const lobbyParamsSchema = z.object({
  lobbyId: z.string().min(1)
});

const joinLobbySchema = z.object({
  joinCode: z.string().length(6).optional()
});

const autoJoinSchema = z.object({
  currency: z.nativeEnum(Currency),
  stakeMinor: z.coerce.bigint().positive()
});

const lobbyRoutes: FastifyPluginAsync = async (app) => {
  app.post('/', { preHandler: app.authenticate }, async (request) => {
    const body = createLobbySchema.parse(request.body);

    return app.services.lobby.createLobby(request.authUser.id, {
      currency: body.currency,
      stakeMinor: body.stakeMinor,
      visibility: body.visibility,
      autoStart: body.autoStart,
      metadata: body.metadata as Prisma.InputJsonValue | undefined
    });
  });

  app.get('/', { preHandler: app.authenticate }, async (request) => {
    const query = listLobbiesSchema.parse(request.query);

    return app.services.lobby.listLobbies({
      currency: query.currency,
      stakeMinor: query.stakeMinor,
      visibility: query.visibility,
      onlyJoinable: query.onlyJoinable
    });
  });

  app.get('/:lobbyId', { preHandler: app.authenticate }, async (request) => {
    const { lobbyId } = lobbyParamsSchema.parse(request.params);
    return app.services.lobby.getLobbyById(lobbyId);
  });

  app.post('/:lobbyId/join', { preHandler: app.authenticate }, async (request) => {
    const { lobbyId } = lobbyParamsSchema.parse(request.params);
    const body = joinLobbySchema.parse(request.body ?? {});
    return app.services.lobby.joinLobby(request.authUser.id, lobbyId, body.joinCode);
  });

  app.post('/auto-join', { preHandler: app.authenticate }, async (request) => {
    const body = autoJoinSchema.parse(request.body);
    return app.services.lobby.autoJoin(request.authUser.id, {
      currency: body.currency,
      stakeMinor: body.stakeMinor
    });
  });

  app.post('/:lobbyId/leave', { preHandler: app.authenticate }, async (request) => {
    const { lobbyId } = lobbyParamsSchema.parse(request.params);
    return app.services.lobby.leaveLobby(request.authUser.id, lobbyId);
  });
};

export default lobbyRoutes;
