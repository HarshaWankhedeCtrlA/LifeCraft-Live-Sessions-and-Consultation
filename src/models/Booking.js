const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
  {
    slotId: { type: mongoose.Schema.Types.ObjectId, ref: 'Slot', required: true },
    mentorId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    durationMinutes: { type: Number, required: true },
    topic: { type: String, trim: true, maxlength: 300 },
    status: {
      type: String,
      enum: ['confirmed', 'cancelled', 'completed', 'no_show'],
      default: 'confirmed',
    },
    // Filled in by Sr 3 (pricing) / Commerce later
    amount: { type: Number, default: null },
    currency: { type: String, default: 'INR' },
    paymentStatus: { type: String, enum: ['pending', 'paid', 'free', 'refunded'], default: 'free' },
    cancelledAt: Date,
    cancelledBy: String,
    cancelReason: { type: String, maxlength: 300 },
  },
  { timestamps: true }
);

// One active booking per slot, enforced by the database
bookingSchema.index(
  { slotId: 1 },
  { unique: true, partialFilterExpression: { status: 'confirmed' } }
);
bookingSchema.index({ userId: 1, startTime: 1 });

module.exports = mongoose.model('Booking', bookingSchema);