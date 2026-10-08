const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const LiveSession = require('../models/LiveSession');
const chat = require('../services/chatService');

module.exports = (httpServer) => {
  const origins = (process.env.CORS_ORIGINS || '*').split(',');
  const io = new Server(httpServer, { cors: { origin: origins.includes('*') ? '*' : origins } });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || (socket.handshake.headers.authorization || '').replace(/^Bearer /, '');
    try {
      const p = jwt.verify(token, process.env.JWT_ACCESS_SECRET, { issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE });
      socket.user = { id: String(p.sub || p.userId), role: p.role };
      next();
    } catch { next(new Error('unauthorized')); }
  });

  io.on('connection', (socket) => {
    // client: socket.emit('chat:join', { bookingId }, (res) => ...)
    socket.on('chat:join', async ({ bookingId } = {}, ack) => {
      try {
        if (!mongoose.Types.ObjectId.isValid(bookingId)) throw new Error('invalid');
        const s = await LiveSession.findOne({ bookingId }).select('mentorId userId').lean();
        const allowed = s && [s.mentorId, s.userId].includes(socket.user.id);
        if (!allowed) throw new Error('forbidden');
        socket.join(`chat:${bookingId}`);
        ack?.({ ok: true });
      } catch (e) { ack?.({ ok: false, error: e.message }); }
    });
    socket.on('chat:leave', ({ bookingId } = {}) => socket.leave(`chat:${bookingId}`));
  });

  chat.setIO(io);
  return io;
};