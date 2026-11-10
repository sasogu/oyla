import rateLimit from '@fastify/rate-limit';
import {
  createPresentationBody,
  createQuestionBody,
  LIMITS,
  reorderQuestionsBody,
  type ServerConfigDto,
  updatePresentationBody,
  updateQuestionBody,
} from '@oyla/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../app-error';
import { requireSameOrigin, resolveTeacher } from '../central-session';
import type { AppConfig } from '../config';
import type { PresentationService } from '../service';
import { requireAdmin } from './admin';
import { parse } from './errors';

const entityId = z.string().min(1).max(32);
const presentationParams = z.object({ id: entityId });
const questionParams = z.object({ id: entityId, questionId: entityId });

export interface RouteDeps {
  service: PresentationService;
  config: AppConfig;
}

export async function apiRoutes(app: FastifyInstance, { service, config }: RouteDeps) {
  // One shared budget per IP for every route in this scope; static files live outside it.
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimits.apiPerMinute,
    timeWindow: '1 minute',
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Vary', 'Cookie, Origin');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      requireSameOrigin(config, request.headers);
    }
  });

  app.get('/account/session', async (request) => {
    const identity = await resolveTeacher(config, request.headers.cookie);
    return {
      enabled: !!config.central,
      authenticated: !!identity,
      displayName: identity?.displayName ?? '',
      commonsUrl: config.central?.publicUrl ?? null,
      loginUrl: config.central
        ? `${config.central.publicUrl}/api/auth/oidc/login?next=${encodeURIComponent(`${config.central.origin}/`)}`
        : null,
    };
  });

  const teacher = async (request: import('fastify').FastifyRequest) => {
    const identity = await resolveTeacher(config, request.headers.cookie);
    if (!identity) throw new AppError('UNAUTHORIZED', 401, 'Teacher account required');
    return identity;
  };

  app.get('/account/presentations', async (request) => service.mine((await teacher(request)).id));
  app.post('/presentations/:id/claim', async (request) => {
    const { id } = parse(presentationParams, request.params);
    const identity = await teacher(request);
    const match = /^Bearer ([A-Za-z0-9_-]{1,100})$/.exec(request.headers.authorization ?? '');
    return service.claim(id, match?.[1] ?? '', identity.id);
  });

  app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }));

  app.get(
    '/config',
    async (): Promise<ServerConfigDto> => ({
      createPasswordRequired: config.createPassword !== null,
      retentionDays: config.retentionDays,
      limits: LIMITS,
      ...(config.central ? { accountEnabled: true } : {}),
    }),
  );

  app.post(
    '/presentations',
    { config: { rateLimit: { max: config.rateLimits.createPerHour, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const body = parse(createPresentationBody, request.body);
      const identity = config.central ? await teacher(request) : null;
      return reply.status(201).send(service.create(body, identity?.id));
    },
  );

  app.get('/presentations/:id', async (request) => {
    const { id } = parse(presentationParams, request.params);
    await requireAdmin(request, service, id, config);
    return service.get(id);
  });

  app.patch('/presentations/:id', async (request) => {
    const { id } = parse(presentationParams, request.params);
    await requireAdmin(request, service, id, config);
    const body = parse(updatePresentationBody, request.body);
    return service.update(id, body);
  });

  app.delete('/presentations/:id', async (request, reply) => {
    const { id } = parse(presentationParams, request.params);
    await requireAdmin(request, service, id, config);
    service.remove(id);
    return reply.status(204).send();
  });

  app.get('/presentations/:id/responses', async (request) => {
    const { id } = parse(presentationParams, request.params);
    await requireAdmin(request, service, id, config);
    return service.exportResponses(id);
  });

  app.post('/presentations/:id/questions', async (request, reply) => {
    const { id } = parse(presentationParams, request.params);
    await requireAdmin(request, service, id, config);
    const body = parse(createQuestionBody, request.body);
    return reply.status(201).send(service.addQuestion(id, body));
  });

  app.put('/presentations/:id/questions/order', async (request) => {
    const { id } = parse(presentationParams, request.params);
    await requireAdmin(request, service, id, config);
    const body = parse(reorderQuestionsBody, request.body);
    return service.reorder(id, body.ids);
  });

  app.patch('/presentations/:id/questions/:questionId', async (request) => {
    const { id, questionId } = parse(questionParams, request.params);
    await requireAdmin(request, service, id, config);
    const body = parse(updateQuestionBody, request.body);
    return service.updateQuestion(id, questionId, body);
  });

  app.delete('/presentations/:id/questions/:questionId', async (request, reply) => {
    const { id, questionId } = parse(questionParams, request.params);
    await requireAdmin(request, service, id, config);
    service.deleteQuestion(id, questionId);
    return reply.status(204).send();
  });

  app.delete('/presentations/:id/questions/:questionId/responses', async (request, reply) => {
    const { id, questionId } = parse(questionParams, request.params);
    await requireAdmin(request, service, id, config);
    service.resetResults(id, questionId);
    return reply.status(204).send();
  });
}
