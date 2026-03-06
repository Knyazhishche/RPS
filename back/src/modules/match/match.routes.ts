import { FastifyPluginAsync } from 'fastify';
import { Move } from '@prisma/client';
import { z } from 'zod';

const matchParamsSchema = z.object({
  matchId: z.string().min(1)
});

const commitBodySchema = z.object({
  commitHash: z.string().regex(/^[A-Fa-f0-9]{64}$/)
});

const revealBodySchema = z.object({
  move: z.nativeEnum(Move),
  salt: z.string().min(8).max(128)
});

const matchRoutes: FastifyPluginAsync = async (app) => {
  app.get('/:matchId', { preHandler: app.authenticate }, async (request) => {
    const { matchId } = matchParamsSchema.parse(request.params);
    return app.services.match.getMatchById(matchId, request.authUser.id);
  });

  app.post('/:matchId/commit', { preHandler: app.authenticate }, async (request) => {
    const { matchId } = matchParamsSchema.parse(request.params);
    const body = commitBodySchema.parse(request.body);

    return app.services.match.commitMove({
      userId: request.authUser.id,
      matchId,
      commitHash: body.commitHash.toLowerCase()
    });
  });

  app.post('/:matchId/reveal', { preHandler: app.authenticate }, async (request) => {
    const { matchId } = matchParamsSchema.parse(request.params);
    const body = revealBodySchema.parse(request.body);

    return app.services.match.revealMove({
      userId: request.authUser.id,
      matchId,
      move: body.move,
      salt: body.salt
    });
  });
};

export default matchRoutes;
