const LiveSession = require('../models/LiveSession');
const Reminder = require('../models/Reminder');
const { notify } = require('./notifier');
const { ensureSession } = require('./sessionService');

const when = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

exports.onBookingConfirmed = async (b) => {
  await ensureSession(b);
  await require('./recordingService').ensureRecording(b).catch(console.error);
  const offsets = (process.env.REMINDER_OFFSETS_MIN || '1440,60,10').split(',').map(Number).filter((n) => n > 0);
  const docs = [];
  for (const [userId, role] of [[b.userId, 'seeker'], [b.mentorId, 'mentor']])
    for (const m of offsets) {
      const remindAt = new Date(b.startTime.getTime() - m * 60000);
      if (remindAt > new Date()) docs.push({ bookingId: b._id, userId, role, type: `${m}m`, remindAt });
    }
  if (docs.length) await Reminder.insertMany(docs, { ordered: false }).catch(() => {});

  const data = { bookingId: String(b._id), startTime: b.startTime };
  await Promise.allSettled([
    notify({ userId: b.userId, type: 'session_booked', title: 'Session confirmed', body: `Your session is booked for ${when(b.startTime)} IST.`, data }),
    notify({ userId: b.mentorId, type: 'session_booked', title: 'New session booked', body: `A session was booked for ${when(b.startTime)} IST.`, data }),
  ]);
};

exports.onBookingCancelled = async (b) => {
  await Promise.all([
    LiveSession.updateOne({ bookingId: b._id, status: 'scheduled' }, { $set: { status: 'cancelled', endReason: 'booking_cancelled' } }),
    Reminder.updateMany({ bookingId: b._id, status: { $in: ['pending', 'sending'] } }, { $set: { status: 'cancelled' } }),
  ]);
  const other = b.cancelledBy === b.userId ? b.mentorId : b.userId;
  await notify({
    userId: other, type: 'session_cancelled', title: 'Session cancelled',
    body: `The session on ${when(b.startTime)} IST was cancelled.`, data: { bookingId: String(b._id) },
  }).catch(console.error);
};