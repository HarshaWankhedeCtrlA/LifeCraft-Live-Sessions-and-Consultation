const mongoose = require('mongoose');

const extensionSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    mentorId: { type: String, required: true },
    userId: { type: String, required: true },
    minutes: { type: Number, required: true },
    amount: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    status: { type: String, enum: ['requested', 'approved', 'rejected', 'expired', 'cancelled'], default: 'requested' },
    paymentStatus: { type: String, enum: ['free', 'pending', 'paid'], default: 'free' },
    expiresAt: { type: Date, required: true },
    decidedAt: Date,
    decidedBy: String,
    rejectReason: { type: String, maxlength: 300 },
    prevEndsAt: Date,
    newEndsAt: Date,
  },
  { timestamps: true }
);

// Only one open request per booking
extensionSchema.index({ bookingId: 1 }, { unique: true, partialFilterExpression: { status: 'requested' } });
extensionSchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.model('Extension', extensionSchema);