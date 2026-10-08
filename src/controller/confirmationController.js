const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const LiveSession = require('../models/LiveSession');
const Reminder = require('../models/Reminder');
const { runReminders } = require('../workers/reminderWorker');

// GET /sessions/live/:bookingId/confirmation
exports.confirmation = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.bookingId))
    return res.status(400).json({ success: false, message: 'Invalid id' });
  const b = await Booking.findById(req.params.bookingId).lean();
  if (!b) return res.status(404).json({ success: false, message: 'Booking not found' });
  if (![b.userId, b.mentorId].includes(req.user.id) && req.user.role !== 'admin')
    return res.status(403).json({ success: false, message: 'Not allowed' });

  const [session, reminders] = await Promise.all([
    LiveSession.findOne({ bookingId: b._id }).lean(),
    Reminder.find({ bookingId: b._id, userId: req.user.id }).sort({ remindAt: 1 }).select('type remindAt status -_id').lean(),
  ]);
  res.json({
    success: true,
    data: {
      confirmationCode: String(b._id).slice(-8).toUpperCase(),
      bookingId: b._id, status: b.status, mentorId: b.mentorId, topic: b.topic,
      startTime: b.startTime, endTime: b.endTime, durationMinutes: b.durationMinutes,
      amount: b.amount, currency: b.currency, paymentStatus: b.paymentStatus,
      waitingRoomOpensAt: session ? new Date(+session.scheduledStart - Number(process.env.WAITING_ROOM_OPEN_MINUTES || 10) * 60000) : null,
      reminders,
    },
  });
};

// GET /sessions/live/admin/reminders?status=
exports.listReminders = async (req, res) => {
  const filter = req.query.status ? { status: req.query.status } : {};
  const items = await Reminder.find(filter).sort({ remindAt: -1 }).limit(200).lean();
  res.json({ success: true, total: items.length, data: items });
};

// POST /sessions/live/admin/reminders/run
exports.runNow = async (_req, res) => res.json({ success: true, ...(await runReminders()) });