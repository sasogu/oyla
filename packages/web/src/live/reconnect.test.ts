import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io } from 'socket.io-client';
import { expect, test } from 'vitest';
import { reconnectAfterServerDisconnect } from './reconnect';
import type { OylaSocket } from './socket';

test('reconnects after a real server disconnect, without reviving a deliberately closed session', async () => {
  const http = createServer();
  const server = new Server(http, { serveClient: false });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  let connections = 0;
  server.on('connection', () => {
    connections++;
  });
  const socket: OylaSocket = io(`http://127.0.0.1:${address.port}`, {
    transports: ['websocket'],
    reconnection: false,
  });
  const stop = reconnectAfterServerDisconnect(socket);
  try {
    await expect.poll(() => connections).toBe(1);
    server.disconnectSockets(true);
    await expect.poll(() => connections).toBe(2);
    expect(socket.connected).toBe(true);
    socket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(connections).toBe(2);
    socket.connect();
    await expect.poll(() => connections).toBe(3);
    server.disconnectSockets(true);
    stop(); // Closing the page cancels a pending reconnect.
    socket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(connections).toBe(3);
  } finally {
    stop();
    socket.disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
