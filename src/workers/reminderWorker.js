const Reminder = require('../models/Reminder');
const Booking = require('../models/Booking');
const { notify } = require('../services/notifier');

const label = (m) => (m >= 1440 ? `${m / 1440} day` : m >= 60 ? `${m / 60} hour${m >= 120 ? 's' : ''}` : `${m} minutes`);

exports.runReminders = async () => {
  const now = new Date();
  // Recover claims abandoned by a crashed worker
  await Reminder.updateMany({ status: 'sending', updatedAt: { $lt: new Date(now - 5 * 60000) } }, { $set: { status: 'pending' } });

  let sent = 0, skipped = 0, failed = 0;
  for (let i = 0; i < 200; i++) {
    const r = await Reminder.findOneAndUpdate(
      { status: 'pending', remindAt: { $lte: new Date() } },
      { $set: { status: 'sending' }, $inc: { attempts: 1 } },
      { sort: { remindAt: 1 }, new: true }
    );
    if (!r) break;
    try {
      const b = await Booking.findById(r.bookingId).lean();
      if (!b || b.status !== 'confirmed' || b.startTime <= new Date()) {
        await Reminder.updateOne({ _id: r._id }, { $set: { status: 'cancelled' } });
        skipped++;
        continue;
      }
      const m = parseInt(r.type, 10);
      await notify({
        userId: r.userId, type: 'session_reminder', title: 'Session reminder',
        body: `Your session starts in ${label(m)}.`, data: { bookingId: String(r.bookingId), role: r.role },
      });
      await Reminder.updateOne({ _id: r._id }, { $set: { status: 'sent', sentAt: new Date() } });
      sent++;
    } catch (e) {
      const final = r.attempts >= 3;
      await Reminder.updateOne(
        { _id: r._id },
        { $set: { status: final ? 'failed' : 'pending', error: e.message, remindAt: final ? r.remindAt : new Date(Date.now() + 60000) } }
      );
      if (final) failed++;
    }
  }
  return { sent, skipped, failed };
};