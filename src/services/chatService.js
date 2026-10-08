const ChatMessage = require('../models/ChatMessage');
const { clockFor } = require('./sessionService');

let io = null;
exports.setIO = (instance) => { io = instance; };
exports.emit = (bookingId, event, payload) => { if (io) io.to(`chat:${bookingId}`).emit(event, payload); };

exports.isOpen = (s) => ['waiting_room', 'in_progress'].includes(clockFor(s).phase);

// 20 messages per 10 seconds per user (per instance)
const hits = new Map();
exports.rateLimited = (userId) => {
  const now = Date.now();
  const arr = (hits.get(userId) || []).filter((t) => now - t < 10000);
  arr.push(now);
  hits.set(userId, arr);
  if (hits.size > 10000) hits.clear();
  return arr.length > 20;
};

exports.post = async ({ s, senderId, senderRole, type = 'text', text, fileId = null, clientMessageId }) => {
  try {
    const m = await ChatMessage.create({ bookingId: s.bookingId, senderId, senderRole, type, text, fileId, clientMessageId });
    const out = m.toObject();
    exports.emit(s.bookingId, 'chat:message', out);
    return { message: out, duplicate: false };
  } catch (e) {
    if (e.code === 11000 && clientMessageId)
      return { message: await ChatMessage.findOne({ bookingId: s.bookingId, senderId, clientMessageId }).lean(), duplicate: true };
    throw e;
  }
};