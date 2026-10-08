const mongoose = require('mongoose');

const slotSchema = new mongoose.Schema(
  {
    mentorId: { type: String, required: true, index: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    durationMinutes: { type: Number, required: true },
    status: { type: String, enum: ['available', 'booked', 'blocked'], default: 'available' },
    bookedBy: { type: String, default: null },
    bookingId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true }
);

slotSchema.index({ mentorId: 1, startTime: 1 }, { unique: true });
slotSchema.index({ status: 1, startTime: 1 });

module.exports = mongoose.model('Slot', slotSchema);