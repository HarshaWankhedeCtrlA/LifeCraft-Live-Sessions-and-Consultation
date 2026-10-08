const mongoose = require('mongoose');

const availabilitySchema = new mongoose.Schema(
  {
    mentorId: { type: String, required: true, unique: true },
    windows: [{ _id: false, dayOfWeek: Number, startTime: String, endTime: String, durationMinutes: Number }],
    bufferMinutes: { type: Number, default: 0 },
    horizonDays: { type: Number, default: 30 },
    holidays: [{ _id: false, date: String, reason: String }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Availability', availabilitySchema);