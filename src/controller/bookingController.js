const mongoose = require('mongoose');
const Slot = require('../models/Slot');
const Booking = require('../models/Booking');
const { getPrice } = require('../services/pricingService');
const hooks = require('../services/bookingHooks');
const HOUR = 3600 * 1000;
const isId = (id) => mongoose.Types.ObjectId.isValid(id);

// POST /sessions/bookings  { slotId, topic? }
exports.createBooking = async (req, res) => {
  const { slotId, topic } = req.body;
  if (!isId(slotId)) return res.status(400).json({ success: false, message: 'Valid slotId required' });

  const slot = await Slot.findById(slotId).lean();
  if (!slot) return res.status(404).json({ success: false, message: 'Slot not found' });
  if (slot.mentorId === req.user.id)
    return res.status(400).json({ success: false, message: 'You cannot book your own slot' });

  const minLead = Number(process.env.MIN_BOOKING_LEAD_MINUTES || 15) * 60000;
  if (slot.startTime.getTime() - Date.now() < minLead)
    return res.status(400).json({ success: false, message: 'Slot starts too soon to book' });

  // User cannot hold two overlapping sessions
  const clash = await Booking.findOne({
    userId: req.user.id,
    status: 'confirmed',
    startTime: { $lt: slot.endTime },
    endTime: { $gt: slot.startTime },
  }).lean();
  if (clash)
    return res.status(409).json({ success: false, message: 'You already have a session at this time' });
  const price = await getPrice(slot.mentorId, slot.durationMinutes);
  if (!price)
    return res.status(400).json({ success: false, message: 'Pricing is not available for this session' });
  // Atomic reservation: only one request can flip available -> booked
  const reserved = await Slot.findOneAndUpdate(
    { _id: slotId, status: 'available', startTime: { $gt: new Date(Date.now() + minLead) } },
    { $set: { status: 'booked', bookedBy: req.user.id } },
    { new: true }
  );
  if (!reserved)
    return res.status(409).json({ success: false, message: 'Slot is no longer available' });

  try {
    const booking = await Booking.create({
      slotId: reserved._id,
      mentorId: reserved.mentorId,
      userId: req.user.id,
      startTime: reserved.startTime,
      endTime: reserved.endTime,
            amount: price.amount,
      currency: price.currency,
      paymentStatus: price.amount > 0 ? 'pending' : 'free',
      durationMinutes: reserved.durationMinutes,
      topic,
    });
    await Slot.updateOne({ _id: reserved._id }, { $set: { bookingId: booking._id } });
    // Sr 5 will send confirmation + reminders from here
        await hooks.onBookingConfirmed(booking).catch(console.error);
    res.status(201).json({ success: true, data: booking });
  } catch (e) {
    // Roll back the reservation if the booking could not be saved
    await Slot.updateOne({ _id: reserved._id }, { $set: { status: 'available', bookedBy: null, bookingId: null } });
    if (e.code === 11000)
      return res.status(409).json({ success: false, message: 'Slot is no longer available' });
    throw e;
  }
};

// GET /sessions/bookings/me?status=&upcoming=true&page=&pageSize=
exports.myBookings = (field) => async (req, res) => {
  const { status, upcoming } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 10));

  const filter = { [field]: req.user.id };
  if (status) {
    if (!['confirmed', 'cancelled', 'completed', 'no_show'].includes(status))
      return res.status(400).json({ success: false, message: 'Invalid status' });
    filter.status = status;
  }
  if (upcoming === 'true') filter.startTime = { $gte: new Date() };

  const [items, total] = await Promise.all([
    Booking.find(filter)
      .sort({ startTime: upcoming === 'true' ? 1 : -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Booking.countDocuments(filter),
  ]);
  res.json({ success: true, page, pageSize, total, data: items });
};

// GET /sessions/bookings/:id  (booker, mentor or admin)
exports.getBooking = async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid id' });
  const b = await Booking.findById(req.params.id).lean();
  if (!b) return res.status(404).json({ success: false, message: 'Booking not found' });
  if (![b.userId, b.mentorId].includes(req.user.id) && req.user.role !== 'admin')
    return res.status(403).json({ success: false, message: 'Not allowed' });
  res.json({ success: true, data: b });
};

// POST /sessions/bookings/:id/cancel  { reason? }
exports.cancelBooking = async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid id' });
  const b = await Booking.findById(req.params.id);
  if (!b) return res.status(404).json({ success: false, message: 'Booking not found' });

  const isAdmin = req.user.role === 'admin';
  if (![b.userId, b.mentorId].includes(req.user.id) && !isAdmin)
    return res.status(403).json({ success: false, message: 'Not allowed' });
  if (b.status !== 'confirmed')
    return res.status(400).json({ success: false, message: `Booking is already ${b.status}` });

  // Users must cancel before the cutoff; mentors and admins are not restricted
  const cutoff = Number(process.env.CANCEL_CUTOFF_HOURS || 2) * HOUR;
  if (b.userId === req.user.id && b.startTime.getTime() - Date.now() < cutoff)
    return res.status(400).json({
      success: false,
      message: `Cancellation closes ${process.env.CANCEL_CUTOFF_HOURS || 2} hours before the session`,
    });

  // Atomic status change so a double-tap cannot cancel twice
  const updated = await Booking.findOneAndUpdate(
    { _id: b._id, status: 'confirmed' },
    {
      $set: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledBy: req.user.id,
        cancelReason: (req.body.reason || '').slice(0, 300),
      },
    },
    { new: true }
  );
  if (!updated) return res.status(409).json({ success: false, message: 'Booking already cancelled' });

  // Free the slot again only if it is still in the future
  if (b.startTime > new Date())
    await Slot.updateOne(
      { _id: b.slotId, bookingId: b._id },
      { $set: { status: 'available', bookedBy: null, bookingId: null } }
    );
  hooks.onBookingCancelled(updated).catch(console.error);
  // Refund (Commerce) and notifications (Sr 5) hook in here
  res.json({ success: true, data: updated });
};