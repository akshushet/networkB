// presence.js (server-side snippet)
const socketsByCode = new Map(); // code -> Set<socket.id>
const lastSeenByCode = new Map(); // code -> timestamp

function getOnline(code) {
  const set = socketsByCode.get(code);
  return !!(set && set.size);
}

function addSocket(code, socketId) {
  if (!socketsByCode.has(code)) socketsByCode.set(code, new Set());
  socketsByCode.get(code).add(socketId);
}

function removeSocket(code, socketId) {
  const set = socketsByCode.get(code);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) {
    socketsByCode.delete(code);
    lastSeenByCode.set(code, Date.now());
  }
}

function presencePayload(code) {
  return { code, online: getOnline(code), lastSeen: lastSeenByCode.get(code) || null };
}

module.exports = (io) => {
  io.on('connection', (socket) => {
    // Client will call this immediately after connect
    socket.on('presence:join', ({ code, peer }) => {
      socket.data.code = code;
      socket.data.peer = peer;

      // Track me
      addSocket(code, socket.id);
      // Join a personal room so peers can target me
      socket.join(`user:${code}`);

      // Notify my peer I'm online
      if (peer) {
        io.to(`user:${peer}`).emit('presence:update', presencePayload(code));
      }

      // Reply with current peer presence so UI is correct on first render
      if (peer) {
        socket.emit('presence:update', presencePayload(peer));
      }
    });

    // Let a client explicitly query (optional but handy)
    socket.on('presence:query', ({ who }, ack) => {
      if (typeof ack === 'function') ack(presencePayload(who));
    });

    socket.on('disconnect', () => {
      const { code, peer } = socket.data || {};
      if (!code) return;
      removeSocket(code, socket.id);

      // If I truly went offline (no more sockets), ping my peer with offline + lastSeen
      if (!getOnline(code) && peer) {
        io.to(`user:${peer}`).emit('presence:update', presencePayload(code));
      }
    });
  });
};
