const ChatMessage = require('../models/ChatMessage');
const chat = require('../services/chatService');
const { loadSession, fail } = require('../services/sessionAccess');

// POST /sessions/live/:bookingId/chat  { text, clientMessageId? }
exports.send = async (req, res) => {
  const ctx = await loadSession(req, res);
  if (!ctx) return;
  if (!chat.isOpen(ctx.s)) return fail(res, 403, 'Chat is open only from the waiting room until the session ends');
  if (chat.rateLimited(req.user.id)) return fail(res, 429, 'You are sending messages too quickly');

  const max = Number(process.env.CHAT_MAX_LENGTH || 2000);
  const text = String(req.body.text ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  if (!text || text.length > max) return fail(res, 400, `Message must be 1-${max} characters`);
  const cid = typeof req.body.clientMessageId === 'string' && req.body.clientMessageId.length <= 64 ? req.body.clientMessageId : undefined;

  const { message, duplicate } = await chat.post({ s: ctx.s, senderId: req.user.id, senderRole: ctx.role, text, clientMessageId: cid });
  res.status(duplicate ? 200 : 201).json({ success: true, data: message });
};

// GET /sessions/live/:bookingId/chat?afterId=&beforeId=&limit=50   (oldest first in the response)
exports.history = async (req, res) => {
  const ctx = await loadSession(req, res, { admin: true });
  if (!ctx) return;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const { afterId, beforeId } = req.query;
  const filter = { bookingId: ctx.s.bookingId };

  let items;
  if (afterId) {
    filter._id = { $gt: afterId };
    items = await ChatMessage.find(filter).sort({ _id: 1 }).limit(limit).lean();
  } else {
    if (beforeId) filter._id = { $lt: beforeId };
    items = (await ChatMessage.find(filter).sort({ _id: -1 }).limit(limit).lean()).reverse();
  }
  res.json({ success: true, chatOpen: chat.isOpen(ctx.s), data: items });
};