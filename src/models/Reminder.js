const mongoose = require('mongoose');

const reminderSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    userId: { type: String, required: true },
    role: { type: String, enum: ['seeker', 'mentor'], required: true },
    type: { type: String, required: true },          // e.g. "1440m", "60m", "10m"
    remindAt: { type: Date, required: true },
    status: { type: String, enum: ['pending', 'sending', 'sent', 'failed', 'cancelled'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    sentAt: Date,
    error: String,
  },
  { timestamps: true }
);

reminderSchema.index({ bookingId: 1, userId: 1, type: 1 }, { unique: true });
reminderSchema.index({ status: 1, remindAt: 1 });

module.exports = mongoose.model('Reminder', reminderSchema);