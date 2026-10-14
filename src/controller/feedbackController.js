const mongoose = require('mongoose');
const Feedback = require('../models/Feedback');
const Booking = require('../models/Booking');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, code, message) => res.status(code).json({ success: false, message });

// POST /:bookingId/feedback   body: { rating: 1-5, comment? }
exports.submit = wrap(async (req, res) => {
  const { bookingId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(bookingId)) return fail(res, 400, 'Invalid id');

  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return fail(res, 400, 'rating must be a whole number from 1 to 5');
  }
  const { comment } = req.body;
  if (comment !== undefined && (typeof comment !== 'string' || comment.length > 1000)) {
    return fail(res, 400, 'comment must be text up to 1000 characters');
  }

  const booking = await Booking.findById(bookingId).lean();
  if (!booking) return fail(res, 404, 'Booking not found');

  const me = req.user.id;
  let fromRole;
  let toUserId;
  if (booking.userId === me) {
    fromRole = 'seeker';
    toUserId = booking.mentorId;
  } else if (booking.mentorId === me) {
    fromRole = 'mentor';
    toUserId = booking.userId;
  } else {
    return fail(res, 403, 'Not allowed');
  }

  // closeSession() marks the booking "completed" only if the session actually went live
  if (booking.status !== 'completed') {
    return fail(res, 409, 'Feedback can be given only after the session has been completed');
  }

  try {
    const fb = await Feedback.create({ bookingId, fromUserId: me, toUserId, fromRole, rating, comment });
    res.status(201).json({ success: true, data: fb });
  } catch (err) {
    if (err.code === 11000) return fail(res, 409, 'You have already given feedback for this session');
    throw err;
  }
});

// GET /:bookingId/feedback   -> the feedback I gave (admin sees all for the booking)
exports.mine = wrap(async (req, res) => {
  const { bookingId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(bookingId)) return fail(res, 400, 'Invalid id');
  const filter = { bookingId };
  if (req.user.role !== 'admin') filter.fromUserId = req.user.id;
  const data = await Feedback.find(filter).sort({ createdAt: -1 });
  res.json({ success: true, data });
});

// GET /feedback/mentor/:mentorId?page=&limit=   -> public rating summary + reviews
exports.mentorSummary = wrap(async (req, res) => {
  const { mentorId } = req.params;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
  const match = { toUserId: mentorId, fromRole: 'seeker' };

  const [stats, reviews] = await Promise.all([
    Feedback.aggregate([{ $match: match }, { $group: { _id: '$rating', count: { $sum: 1 } } }]),
    Feedback.find(match)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('rating comment createdAt -_id'), // reviewer identity is not exposed
  ]);

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  let sum = 0;
  for (const s of stats) {
    distribution[s._id] = s.count;
    total += s.count;
    sum += s._id * s.count;
  }
  res.json({
    success: true,
    data: {
      averageRating: total ? Math.round((sum / total) * 10) / 10 : null,
      totalReviews: total,
      distribution,
      reviews,
      pagination: { page, limit },
    },
  });
});