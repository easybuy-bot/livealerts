import { Server } from 'socket.io';
import { config } from '../config.js';
import { get } from '../db.js';
import { sessionUser } from '../middleware/auth.js';

let io = null;

export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    serveClient: true,
  });

  io.on('connection', async (socket) => {
    const token = socket.handshake.query?.token;
    if (token) {
      // Overlay (OBS browser source) connection — scoped strictly to its own room.
      const overlay = get('SELECT * FROM overlays WHERE token = ?', token);
      if (!overlay) {
        socket.emit('error', { message: 'Invalid overlay token' });
        socket.disconnect(true);
        return;
      }
      socket.data.overlayId = overlay.id;
      socket.data.userId = overlay.user_id;
      socket.join(`overlay:${overlay.token}`);
      socket.emit('ready', { overlayId: overlay.id, width: overlay.width, height: overlay.height });
      return;
    }

    // Dashboard connection — authenticated by session cookie.
    const cookie = socket.handshake.headers?.cookie || '';
    const tokenMatch = cookie.match(new RegExp(`(?:^|;\\s*)${config.cookieName}=([^;]+)`));
    const user = tokenMatch ? sessionUser(decodeURIComponent(tokenMatch[1])) : null;
    if (!user) {
      socket.emit('error', { message: 'Not authenticated' });
      socket.disconnect(true);
      return;
    }
    socket.data.userId = user.id;
    socket.join(`user:${user.id}`);
    socket.emit('ready', { userId: user.id });
  });

  return io;
}

export function emitToOverlay(token, event, data) {
  if (!io) return;
  io.to(`overlay:${token}`).emit(event, data);
}

export function emitToUser(userId, event, data) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
}

export function overlayRoom(token) {
  return `overlay:${token}`;
}
