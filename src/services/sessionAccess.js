const mongoose = require('mongoose');
const LiveSession = require('../models/LiveSession');
const Booking = require('../models/Booking');
const { ensureSession } = require('./sessionService');

const fail = (res, code, message, extra = {}) => res.status(code).json({ success: false, message, ...extra });
exports.fail = fail;

// Loads the session and the caller's role. Replies and returns null on failure.
exports.loadSession = async (req, res, { admin = false } = {}) => {
  const { bookingId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(bookingId)) return fail(res, 400, 'Invalid id'), null;
  let s = await LiveSession.findOne({ bookingId });
  if (!s) {
    const b = await Booking.findById(bookingId).lean();
    if (!b || b.status !== 'confirmed') return fail(res, 404, 'Session not found'), null;
    await ensureSession(b);
    s = await LiveSession.findOne({ bookingId });
  }
  const role = s.userId === req.user.id ? 'seeker' : s.mentorId === req.user.id ? 'mentor' : null;
  if (!role && !(admin && req.user.role === 'admin')) return fail(res, 403, 'Not allowed'), null;
  return { s, role };
};