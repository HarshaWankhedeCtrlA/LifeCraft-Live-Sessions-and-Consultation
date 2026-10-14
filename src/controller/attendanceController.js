const mongoose = require('mongoose');
const Attendance = require('../models/Attendance');
const Booking = require('../models/Booking');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, code, message) => res.status(code).json({ success: false, message });

// Loads the booking and checks the caller is its seeker, its mentor, or an admin.
async function loadBooking(req, res) {
  if (!mongoose.Types.ObjectId.isValid(req.params.bookingId)) return fail(res, 400, 'Invalid id'), null;
  const booking = await Booking.findById(req.params.bookingId).lean();
  if (!booking) return fail(res, 404, 'Booking not found'), null;
  const me = req.user.id;
  if (booking.userId !== me && booking.mentorId !== me && req.user.role !== 'admin') {
    return fail(res, 403, 'Not allowed'), null;
  }
  return booking;
}

// POST /:bookingId/leave   (the app calls this when the person leaves the call)
exports.leave = wrap(async (req, res) => {
  const booking = await loadBooking(req, res);
  if (!booking) return;
  const doc = await Attendance.recordLeave(booking._id, req.user.id);
  if (!doc) return fail(res, 404, 'You have not joined this session');
  res.json({ success: true, data: { totalSeconds: doc.totalSeconds, lastLeftAt: doc.lastLeftAt } });
});

// GET /:bookingId/attendance
exports.list = wrap(async (req, res) => {
  const booking = await loadBooking(req, res);
  if (!booking) return;
  const docs = await Attendance.find({ bookingId: booking._id });
  const now = Date.now();
  const data = docs.map((d) => {
    const open = d.intervals[d.intervals.length - 1];
    const isOnline = !!(open && !open.leftAt);
    const liveSeconds = isOnline ? Math.round((now - open.joinedAt.getTime()) / 1000) : 0;
    return {
      userId: d.userId,
      role: d.role,
      firstJoinedAt: d.firstJoinedAt,
      lastLeftAt: d.lastLeftAt,
      joinCount: d.intervals.length,
      totalSeconds: d.totalSeconds + liveSeconds,
      isOnline,
    };
  });
  res.json({ success: true, data });
});