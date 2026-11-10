import {
  presenterActivateSchema,
  presenterHideEntrySchema,
  presenterHideNicknameSchema,
  presenterJoinSchema,
  presenterMarkAnsweredSchema,
  presenterResetSchema,
  presenterShowHiddenSchema,
  toThemeKey,
} from '@oyla/shared';
import { AppError } from '../app-error';
import { resolveTeacher } from '../central-session';
import { handle, parsePayload, rateLimited } from './handle';
import { leaveCurrent } from './session';
import { TokenBucket } from './token-bucket';
import { type LiveContext, type OylaSocket, rooms } from './types';

export function registerPresenterHandlers(socket: OylaSocket, context: LiveContext) {
  const { service, broadcaster, log } = context;
  const joins = new TokenBucket(5, 0.5);
  const commands = new TokenBucket(20, 5);

  // A signed cookie captured by a WebSocket must not keep receiving private results after
  // logout elsewhere. Commands also revalidate immediately, rather than waiting for this check.
  let checking = false;
  const expiry = setInterval(async () => {
    if (checking || socket.data.role !== 'presenter' || !socket.data.presentationId) return;
    checking = true;
    try {
      const identity = await resolveTeacher(context.config, socket.request.headers.cookie);
      service.authorize(socket.data.presentationId, socket.data.adminToken ?? '', identity?.id);
    } catch {
      leaveCurrent(socket, context);
      socket.disconnect(true);
    } finally {
      checking = false;
    }
  }, 30_000);
  expiry.unref();
  socket.once('disconnect', () => clearInterval(expiry));

  async function requirePresenter(): Promise<string> {
    const { role, presentationId } = socket.data;
    if (role !== 'presenter' || !presentationId) {
      throw new AppError('UNAUTHORIZED', 401, 'Not a presenter');
    }
    if (!commands.take()) rateLimited();
    const identity = await resolveTeacher(context.config, socket.request.headers.cookie);
    service.authorize(presentationId, socket.data.adminToken ?? '', identity?.id);
    return presentationId;
  }

  socket.on('presenter:join', (payload, ack) =>
    handle(log, ack, async () => {
      if (!joins.take()) rateLimited();
      const { presentationId, adminToken } = parsePayload(presenterJoinSchema, payload);
      const identity = await resolveTeacher(context.config, socket.request.headers.cookie);
      const presentation = service.authorize(presentationId, adminToken, identity?.id);
      leaveCurrent(socket, context);
      socket.data = { ip: socket.data.ip, role: 'presenter', presentationId, adminToken };
      socket.join(rooms.presenters(presentationId));
      return {
        title: presentation.title,
        theme: toThemeKey(presentation.theme),
        ...service.presenterState(presentationId),
        participants: broadcaster.participantCount(presentationId),
        results: presentation.activeQuestionId
          ? service.results(presentationId, presentation.activeQuestionId)
          : null,
      };
    }),
  );

  socket.on('presenter:activate', (payload, ack) =>
    handle(log, ack, async () => {
      const presentationId = await requirePresenter();
      const { questionId } = parsePayload(presenterActivateSchema, payload);
      service.activate(presentationId, questionId);
      return {};
    }),
  );

  socket.on('presenter:reset', (payload, ack) =>
    handle(log, ack, async () => {
      const presentationId = await requirePresenter();
      const { questionId } = parsePayload(presenterResetSchema, payload);
      service.resetResults(presentationId, questionId);
      return {};
    }),
  );

  socket.on('presenter:hide-entry', (payload, ack) =>
    handle(log, ack, async () => {
      const presentationId = await requirePresenter();
      const { questionId, key } = parsePayload(presenterHideEntrySchema, payload);
      service.hideEntry(presentationId, questionId, key);
      return {};
    }),
  );

  socket.on('presenter:mark-answered', (payload, ack) =>
    handle(log, ack, async () => {
      const presentationId = await requirePresenter();
      const { questionId, key, answered } = parsePayload(presenterMarkAnsweredSchema, payload);
      service.markAnswered(presentationId, questionId, key, answered);
      return {};
    }),
  );

  socket.on('presenter:leaderboard', (_payload, ack) =>
    handle(log, ack, async () => ({ leaderboard: service.leaderboard(await requirePresenter()) })),
  );

  socket.on('presenter:hide-nickname', (payload, ack) =>
    handle(log, ack, async () => {
      const presentationId = await requirePresenter();
      const { id } = parsePayload(presenterHideNicknameSchema, payload);
      service.hideNickname(presentationId, id);
      return {};
    }),
  );

  socket.on('presenter:show-hidden', (payload, ack) =>
    handle(log, ack, async () => {
      const presentationId = await requirePresenter();
      const { questionId } = parsePayload(presenterShowHiddenSchema, payload);
      service.showHidden(presentationId, questionId);
      return {};
    }),
  );
}
