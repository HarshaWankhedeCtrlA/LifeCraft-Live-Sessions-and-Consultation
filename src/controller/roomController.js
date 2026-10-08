const mongoose = require('mongoose');
const LiveSession = require('../models/LiveSession');
const Booking = require('../models/Booking');
const { clockFor, ensureSession, closeSession } = require('../services/sessionService');
const video = require('../services/videoProvider');

const fail = (res, code, message, extra = {}) => res.status(code).json({ success: false, message, ...extra });

// Loads the session and the caller's role. Returns null after replying on failure.
async function load(req, res, { admin = false } = {}) {
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
}

// Two small updates: always refresh lastSeenAt, set the milestone field only the first time
const touch = async (id, role, milestone) => {
  const now = new Date();
  await LiveSession.updateOne({ _id: id }, { $set: { [`presence.${role}.lastSeenAt`]: now } });
  if (milestone)
    await LiveSession.updateOne({ _id: id, [`presence.${role}.${milestone}`]: null }, { $set: { [`presence.${role}.${milestone}`]: now } });
};

const otherPresent = (s, role) => {
  const p = s.presence?.[role === 'mentor' ? 'seeker' : 'mentor'];
  return !!p?.lastSeenAt && Date.now() - +p.lastSeenAt < Number(process.env.PRESENCE_TTL_SECONDS || 45) * 1000;
};

// ---- Sr 8 / Sr 9: GET /sessions/live/:bookingId/clock ---------------------------------
exports.clock = async (req, res) => {
  const ctx = await load(req, res, { admin: true });
  if (!ctx) return;
  res.json({ success: true, data: clockFor(ctx.s) });
};

// ---- Sr 6: GET /sessions/live/:bookingId/waiting-room (read only) ---------------------
exports.waitingRoomStatus = async (req, res) => {
  const ctx = await load(req, res);
  if (!ctx) return;
  res.json({ success: true, data: { ...clockFor(ctx.s), role: ctx.role, otherPartyPresent: otherPresent(ctx.s, ctx.role) } });
};

// ---- Sr 6: POST /sessions/live/:bookingId/waiting-room/join (call every ~15s as heartbeat)
exports.joinWaitingRoom = async (req, res) => {
  const ctx = await load(req, res);
  if (!ctx) return;
  const c = clockFor(ctx.s);
  if (c.phase === 'cancelled') return fail(res, 410, 'Session was cancelled');
  if (c.phase === 'ended') return fail(res, 410, 'Session has ended');
  if (c.phase === 'upcoming')
    return fail(res, 403, 'Waiting room is not open yet', { waitingRoomOpensAt: c.waitingRoomOpensAt, secondsToStart: c.secondsToStart });

  await touch(ctx.s._id, ctx.role, 'waitingJoinedAt');
  const fresh = await LiveSession.findById(ctx.s._id).lean();
  res.json({ success: true, data: { ...clockFor(fresh), role: ctx.role, otherPartyPresent: otherPresent(fresh, ctx.role) } });
};

// ---- Sr 7: POST /sessions/live/:bookingId/join ----------------------------------------
exports.joinSession = async (req, res) => {
  const ctx = await load(req, res);
  if (!ctx) return;
  const { s, role } = ctx;
  const c = clockFor(s);

  if (c.phase === 'cancelled') return fail(res, 410, 'Session was cancelled');
  if (c.phase === 'ended') return fail(res, 410, 'Session has ended');
  if (c.phase === 'upcoming') return fail(res, 403, 'Session is not open yet', { waitingRoomOpensAt: c.waitingRoomOpensAt });
  if (role === 'seeker' && c.phase !== 'in_progress')
    return fail(res, 403, 'Session has not started yet', { secondsToStart: c.secondsToStart });

  const join = video.createJoinCredentials({ roomName: s.roomName, userId: req.user.id, expiresAt: +s.endsAt });
  await touch(s._id, role, 'joinedAt');

  // Session goes live on the first join at or after the scheduled start
  if (c.phase === 'in_progress')
    await LiveSession.updateOne({ _id: s._id, status: 'scheduled' }, { $set: { status: 'live', actualStart: new Date() } });

  // Sr 12: recording policy. "always" mode starts recording on the first live join.
  const rs = require('../services/recordingService');
  if (c.phase === 'in_progress') await rs.autoStart(s.bookingId, s).catch(console.error);
  const rec = await rs.ensureRecording({ _id: s.bookingId, mentorId: s.mentorId, userId: s.userId });

  res.json({
    success: true,
    data: {
      clock: clockFor(await LiveSession.findById(s._id).lean()),
      join,
      recording: { policy: rec.policy, notice: rs.notice(rec) },
    },
  });
};

// ---- Sr 10: POST /sessions/live/:bookingId/end (mentor or admin, only after start) -----
exports.endSession = async (req, res) => {
  const ctx = await load(req, res, { admin: true });
  if (!ctx) return;
  if (ctx.role !== 'mentor' && req.user.role !== 'admin') return fail(res, 403, 'Only the mentor can end the session');
  if (clockFor(ctx.s).phase !== 'in_progress') return fail(res, 400, 'Session is not in progress');

  const closed = await closeSession({ _id: ctx.s._id }, 'ended_by_mentor');
  if (!closed) return fail(res, 409, 'Session already ended');
  res.json({ success: true, data: clockFor(await LiveSession.findById(ctx.s._id).lean()) });
};