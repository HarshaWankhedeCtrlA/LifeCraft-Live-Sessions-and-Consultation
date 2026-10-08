const mongoose = require('mongoose');
const Extension = require('../models/Extension');
const LiveSession = require('../models/LiveSession');
const Booking = require('../models/Booking');
const Slot = require('../models/Slot');
const { getPrice } = require('../services/pricingService');
const { clockFor } = require('../services/sessionService');
const { loadSession, fail } = require('../services/sessionAccess');
const { notify } = require('../services/notifier');
const chat = require('../services/chatService');

const options = () => (process.env.EXTENSION_OPTIONS_MIN || '15,30').split(',').map(Number);

// Is the mentor committed to another session during the extra time?
const mentorBusy = (s, newEnd) =>
  Booking.exists({
    mentorId: s.mentorId, status: 'confirmed', _id: { $ne: s.bookingId },
    startTime: { $lt: newEnd }, endTime: { $gt: s.endsAt },
  });

// Mentor's price for that length, else prorated from the booking price
async function priceFor(booking, minutes) {
  const p = await getPrice(booking.mentorId, minutes);
  if (p && p.source !== 'unpriced') return p;
  if (booking.amount > 0)
    return { amount: Math.round((booking.amount / booking.durationMinutes) * minutes * 100) / 100, currency: booking.currency, source: 'prorated' };
  return { amount: 0, currency: 'INR', source: 'free' };
}

// POST /sessions/live/:bookingId/extensions  { minutes }
exports.request = async (req, res) => {
  const ctx = await loadSession(req, res);
  if (!ctx) return;
  const { s, role } = ctx;
  if (role !== 'seeker') return fail(res, 403, 'Only the participant can request an extension');

  const minutes = Number(req.body.minutes);
  if (!options().includes(minutes)) return fail(res, 400, `minutes must be one of ${options()}`);

  const c = clockFor(s);
  if (s.status !== 'live' || c.phase !== 'in_progress')
    return fail(res, 400, 'Extensions can be requested only during a live session');
  const window = Number(process.env.EXTENSION_REQUEST_WINDOW_MIN || 15) * 60;
  if (c.secondsRemaining > window)
    return fail(res, 400, `You can request an extension in the last ${window / 60} minutes`, { secondsRemaining: c.secondsRemaining });

  const used = await Extension.countDocuments({ bookingId: s.bookingId, status: 'approved' });
  if (used >= Number(process.env.EXTENSION_MAX_COUNT || 3)) return fail(res, 400, 'Maximum extensions reached');

  if (await mentorBusy(s, new Date(+s.endsAt + minutes * 60000)))
    return fail(res, 409, 'The mentor is not free for the extra time');

  const booking = await Booking.findById(s.bookingId).lean();
  const price = await priceFor(booking, minutes);
  const ttl = Number(process.env.EXTENSION_REQUEST_TTL_MIN || 5) * 60000;

  try {
    const ext = await Extension.create({
      bookingId: s.bookingId, mentorId: s.mentorId, userId: s.userId, minutes,
      amount: price.amount, currency: price.currency, paymentStatus: price.amount > 0 ? 'pending' : 'free',
      // The request can never outlive the session
      expiresAt: new Date(Math.min(Date.now() + ttl, +s.endsAt)),
    });
    notify({ userId: s.mentorId, type: 'extension_requested', title: 'Extension requested',
      body: `The participant asked for ${minutes} more minutes.`, data: { bookingId: String(s.bookingId), extensionId: String(ext._id) } }).catch(console.error);
    chat.emit(s.bookingId, 'session:extension_requested', { extensionId: ext._id, minutes, amount: ext.amount });
    res.status(201).json({ success: true, data: ext });
  } catch (e) {
    if (e.code === 11000) return fail(res, 409, 'An extension request is already pending');
    throw e;
  }
};

// POST /sessions/live/:bookingId/extensions/:extId/approve | reject
exports.decide = (action) => async (req, res) => {
  const ctx = await loadSession(req, res, { admin: true });
  if (!ctx) return;
  const { s, role } = ctx;
  if (role !== 'mentor' && req.user.role !== 'admin') return fail(res, 403, 'Only the mentor can decide');
  if (!mongoose.Types.ObjectId.isValid(req.params.extId)) return fail(res, 400, 'Invalid id');

  const ext = await Extension.findOne({ _id: req.params.extId, bookingId: s.bookingId });
  if (!ext) return fail(res, 404, 'Request not found');
  if (ext.status !== 'requested') return fail(res, 400, `Request is already ${ext.status}`);

  const decided = { decidedAt: new Date(), decidedBy: req.user.id };

  if (action === 'reject') {
    const done = await Extension.findOneAndUpdate(
      { _id: ext._id, status: 'requested' },
      { $set: { ...decided, status: 'rejected', rejectReason: String(req.body.reason || '').slice(0, 300) } },
      { new: true }
    );
    if (!done) return fail(res, 409, 'Request was already handled');
    notify({ userId: ext.userId, type: 'extension_rejected', title: 'Extension declined',
      body: 'The mentor could not extend this session.', data: { bookingId: String(s.bookingId) } }).catch(console.error);
    return res.json({ success: true, data: done });
  }

  // approve
  const c = clockFor(s);
  if (ext.expiresAt <= new Date() || s.status !== 'live' || c.phase !== 'in_progress') {
    await Extension.updateOne({ _id: ext._id, status: 'requested' }, { $set: { status: 'expired' } });
    return fail(res, 410, 'Request expired or the session is no longer live');
  }
  const newEnd = new Date(+s.endsAt + ext.minutes * 60000);
  if (await mentorBusy(s, newEnd)) return fail(res, 409, 'You have another session during the extra time');

  const claimed = await Extension.findOneAndUpdate(
    { _id: ext._id, status: 'requested' },
    { $set: { ...decided, status: 'approved', prevEndsAt: s.endsAt, newEndsAt: newEnd } },
    { new: true }
  );
  if (!claimed) return fail(res, 409, 'Request was already handled');

  // Moves the end time only if the session is still live and nobody changed endsAt meanwhile
  const updated = await LiveSession.findOneAndUpdate(
    { _id: s._id, status: 'live', endsAt: s.endsAt },
    { $set: { endsAt: newEnd }, $inc: { extraSeconds: ext.minutes * 60 } },
    { new: true }
  );
  if (!updated) {
    await Extension.updateOne({ _id: ext._id }, { $set: { status: 'expired' } });
    return fail(res, 409, 'The session ended before the extension could be applied');
  }

  // Nobody can book the mentor's open slots inside the extra time
  await Slot.updateMany(
    { mentorId: s.mentorId, status: 'available', startTime: { $lt: newEnd }, endTime: { $gt: s.endsAt } },
    { $set: { status: 'blocked' } }
  );

  chat.post({ s, senderId: 'system', senderRole: 'system', type: 'system',
    text: `Session extended by ${ext.minutes} minutes.` }).catch(console.error);
  chat.emit(s.bookingId, 'session:extended', { endsAt: newEnd, minutes: ext.minutes });
  notify({ userId: ext.userId, type: 'extension_approved', title: 'Session extended',
    body: `Your session now runs ${ext.minutes} minutes longer.`, data: { bookingId: String(s.bookingId) } }).catch(console.error);

  res.json({
    success: true,
    data: claimed,
    clock: clockFor(updated),
    note: 'Clients must call POST /join again to get a video token valid until the new end time',
  });
};

// POST /sessions/live/:bookingId/extensions/:extId/cancel  (the participant withdraws)
exports.cancel = async (req, res) => {
  const ctx = await loadSession(req, res);
  if (!ctx) return;
  if (ctx.role !== 'seeker') return fail(res, 403, 'Only the participant can withdraw');
  if (!mongoose.Types.ObjectId.isValid(req.params.extId)) return fail(res, 400, 'Invalid id');
  const done = await Extension.findOneAndUpdate(
    { _id: req.params.extId, bookingId: ctx.s.bookingId, status: 'requested' },
    { $set: { status: 'cancelled' } }, { new: true }
  );
  if (!done) return fail(res, 404, 'No pending request found');
  res.json({ success: true, data: done });
};

// GET /sessions/live/:bookingId/extensions
exports.list = async (req, res) => {
  const ctx = await loadSession(req, res, { admin: true });
  if (!ctx) return;
  const items = await Extension.find({ bookingId: ctx.s.bookingId }).sort({ createdAt: -1 }).lean();
  res.json({ success: true, options: options(), data: items });
};