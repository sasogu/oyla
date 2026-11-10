import type { OylaSocket } from './socket';

/** Socket.IO retries transport failures itself, but not an explicit server disconnect. */
export function reconnectAfterServerDisconnect(socket: OylaSocket): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const onDisconnect = (reason: string) => {
    clear();
    if (reason === 'io server disconnect') {
      timer = setTimeout(() => {
        timer = undefined;
        socket.connect(); // The normal join handler revalidates ownership/session on the server.
      }, 500);
    }
  };
  socket.on('disconnect', onDisconnect);
  return () => {
    clear();
    socket.off('disconnect', onDisconnect);
  };
}
