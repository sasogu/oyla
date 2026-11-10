import { createServer, type Server } from 'node:http';
import { io, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { BuiltApp } from './app';
import { startTestApp } from './test-helpers';

const origin = 'https://oyla.example';
const token = 'test-only-application-token-not-a-secret';
let identityServer: Server;
let built: BuiltApp;
let unavailable = false;
let revoked = false;
const sockets: Socket[] = [];
const headers = (who = 'alice') => ({ cookie: `edutictac_oidc=${who}`, origin });

beforeEach(async () => {
  unavailable = false;
  revoked = false;
  identityServer = createServer((request, response) => {
    if (unavailable) {
      response.writeHead(503).end();
      return;
    }
    if (
      request.url !== '/api/internal/session/resolve' ||
      request.headers.authorization !== `Bearer ${token}`
    ) {
      response.writeHead(403).end();
      return;
    }
    const who = request.headers.cookie?.split('=')[1];
    const identity =
      who && ['alice', 'bob', 'student'].includes(who) && !revoked
        ? {
            kind: 'oidc',
            sub: who,
            display_name: who,
            role: who === 'student' ? 'alumno' : 'profesor',
          }
        : { kind: 'anonymous' };
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(identity));
  });
  await new Promise<void>((resolve) => identityServer.listen(0, '127.0.0.1', resolve));
  const address = identityServer.address();
  if (!address || typeof address === 'string') throw new Error('No identity port');
  built = await startTestApp({
    central: {
      url: `http://127.0.0.1:${address.port}`,
      token,
      publicUrl: 'https://commons.example',
      origin,
    },
  });
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  await built?.close();
  await new Promise<void>((resolve) => identityServer.close(() => resolve()));
});

async function create(who = 'alice') {
  const response = await built.app.inject({
    method: 'POST',
    url: '/api/presentations',
    headers: headers(who),
    payload: { title: 'Account presentation' },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{
    id: string;
    adminToken: string;
    joinCode: string;
    accountOwned: boolean;
  }>();
}

describe('teacher accounts', () => {
  test('creates an owned presentation recoverable from a second browser without a key', async () => {
    const item = await create();
    expect(item.accountOwned).toBe(true);
    expect(item.adminToken).toBe('');
    const mine = await built.app.inject({ url: '/api/account/presentations', headers: headers() });
    expect(mine.statusCode).toBe(200);
    expect(mine.headers['cache-control']).toBe('no-store');
    expect(mine.json()).toEqual([
      expect.objectContaining({ id: item.id, title: 'Account presentation' }),
    ]);
    expect(mine.body).not.toContain('adminToken');
    const edit = await built.app.inject({
      url: `/api/presentations/${item.id}`,
      headers: headers(),
    });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().accountOwned).toBe(true);
    expect(
      (
        await built.app.inject({ url: '/api/account/presentations', headers: headers('bob') })
      ).json(),
    ).toEqual([]);
    expect(
      (await built.app.inject({ url: `/api/presentations/${item.id}`, headers: headers('bob') }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await built.app.inject({
          method: 'PATCH',
          url: `/api/presentations/${item.id}`,
          headers: headers('bob'),
          payload: { title: 'Stolen' },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await built.app.inject({
          method: 'DELETE',
          url: `/api/presentations/${item.id}`,
          headers: headers('bob'),
        })
      ).statusCode,
    ).toBe(401);
  });

  test('anonymous, student and spoofed headers cannot create or enumerate account presentations', async () => {
    for (const who of ['', 'student', 'forged']) {
      expect(
        (
          await built.app.inject({
            method: 'POST',
            url: '/api/presentations',
            headers: { ...headers(who), 'x-user-id': 'alice' },
            payload: { title: 'Denied' },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (await built.app.inject({ url: '/api/account/presentations', headers: headers(who) }))
          .statusCode,
      ).toBe(401);
    }
  });

  test('prevents CSRF for account writes', async () => {
    for (const extra of [
      { origin: 'https://evil.example' },
      { origin: '' },
      { 'sec-fetch-site': 'cross-site' },
    ]) {
      expect(
        (
          await built.app.inject({
            method: 'POST',
            url: '/api/presentations',
            headers: { ...headers(), ...extra },
            payload: { title: 'CSRF' },
          })
        ).statusCode,
      ).toBe(403);
    }
  });

  test('keeps account presentations through retention and fails closed when identity is unavailable', async () => {
    const item = await create();
    const legacy = built.service.create({ title: 'Legacy' });
    expect(built.store.presentations.idleIds(Date.now() + 1000)).toEqual([legacy.id]);
    unavailable = true;
    expect(
      (await built.app.inject({ url: `/api/presentations/${item.id}`, headers: headers() }))
        .statusCode,
    ).toBe(503);
    expect(
      (await built.app.inject({ url: '/api/account/presentations', headers: headers() }))
        .statusCode,
    ).toBe(503);
    unavailable = false;
    revoked = true;
    expect(
      (await built.app.inject({ url: `/api/presentations/${item.id}`, headers: headers() }))
        .statusCode,
    ).toBe(401);
  });

  test('authorizes live controls by account, rejects a second teacher and rechecks revoked sessions', async () => {
    const item = await create();
    const question = built.service.addQuestion(item.id, { type: 'multiple-choice' });
    await built.app.listen({ host: '127.0.0.1', port: 0 });
    const address = built.app.server.address();
    if (!address || typeof address === 'string') throw new Error('No app port');
    const connect = async (who: string) => {
      const socket = io(`http://127.0.0.1:${address.port}`, {
        transports: ['websocket'],
        extraHeaders: { Cookie: `edutictac_oidc=${who}` },
        forceNew: true,
        reconnection: false,
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      return socket;
    };
    const alice = await connect('alice');
    const bob = await connect('bob');
    expect((await alice.emitWithAck('presenter:join', { presentationId: item.id })).ok).toBe(true);
    expect((await bob.emitWithAck('presenter:join', { presentationId: item.id })).error.code).toBe(
      'UNAUTHORIZED',
    );
    expect((await alice.emitWithAck('presenter:activate', { questionId: question.id })).ok).toBe(
      true,
    );
    revoked = true;
    expect(
      (await alice.emitWithAck('presenter:reset', { questionId: question.id })).error.code,
    ).toBe('UNAUTHORIZED');
    expect((await alice.emitWithAck('presenter:leaderboard', {})).error.code).toBe('UNAUTHORIZED');
  });
});
