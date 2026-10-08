const LiveSession = require('../models/LiveSession');
const Booking = require('../models/Booking');
const video = require('./videoProvider');

const waitMs = () => Number(process.env.WAITING_ROOM_OPEN_MINUTES || 10) * 60000;

// Creates the live-session record for a booking (idempotent)
exports.ensureSession = async (b) => {
  await LiveSession.updateOne(
    { bookingId: b._id },
    {
      $setOnInsert: {
        mentorId: b.mentorId,
        userId: b.userId,
        scheduledStart: b.startTime,
        scheduledEnd: b.endTime,
        endsAt: b.endTime,
        purchasedSeconds: b.durationMinutes * 60,
        roomName: `lc_${b._id}`,
      },
    },
    { upsert: true }
  );
};

// Single source of truth for timing (Sr 8 countdown + Sr 9 time tracking). Server clock only.
exports.clockFor = (s, nowMs = Date.now()) => {
  const start = +s.scheduledStart;
  const end = +s.endsAt;
  const total = s.purchasedSeconds + (s.extraSeconds || 0);
  let phase;
  if (s.status === 'cancelled') phase = 'cancelled';
  else if (s.status === 'ended' || nowMs >= end) phase = 'ended';
  else if (nowMs >= start) phase = 'in_progress';
  else if (nowMs >= start - waitMs()) phase = 'waiting_room';
  else phase = 'upcoming';
  return {
    serverTime: new Date(nowMs).toISOString(),
    phase,
    status: s.status,
    scheduledStart: s.scheduledStart,
    endsAt: s.endsAt,
    waitingRoomOpensAt: new Date(start - waitMs()),
    totalSeconds: total,
    secondsToStart: Math.max(0, Math.ceil((start - nowMs) / 1000)),
    secondsRemaining: nowMs < start ? total : Math.max(0, Math.ceil((end - nowMs) / 1000)),
    secondsElapsed: nowMs < start ? 0 : Math.min(total, Math.floor((nowMs - start) / 1000)),
  };
};

// Atomically ends a session (Sr 10). Safe to call from several workers/instances at once.
exports.closeSession = async (filter, reason) => {
  const old = await LiveSession.findOneAndUpdate(
    { ...filter, status: { $in: ['scheduled', 'live'] } },
    { $set: { status: 'ended', actualEnd: new Date() } },
    { new: false }
  );
  if (!old) return null;
  const wasLive = old.status === 'live';
  await LiveSession.updateOne({ _id: old._id }, { $set: { endReason: wasLive ? reason : 'never_started' } });
  // Sr 15 (Attendance) will refine no_show per participant
  await Booking.updateOne({ _id: old.bookingId, status: 'confirmed' }, { $set: { status: wasLive ? 'completed' : 'no_show' } });
    require('./recordingService').stop(old.bookingId, 'session_ended').catch(console.error);
  require('../models/Extension').updateMany({ bookingId: old.bookingId, status: 'requested' }, { $set: { status: 'expired' } }).catch(console.error);
  try { await video.endRoom(old.roomName); } catch (e) { console.error('endRoom failed', e.message); }
  return { sessionId: old._id, bookingId: old.bookingId, wasLive };
  
};