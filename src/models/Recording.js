const mongoose = require('mongoose');

const recordingSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    mentorId: { type: String, required: true },
    userId: { type: String, required: true },
    policy: { type: String, enum: ['off', 'on_consent', 'always'], required: true },
    consent: {
      mentor: { type: Boolean, default: null },
      seeker: { type: Boolean, default: null },
    },
    status: {
      type: String,
      enum: ['disabled', 'not_started', 'recording', 'processing', 'ready', 'failed', 'discarded', 'expired'],
      default: 'not_started',
    },
    startedAt: Date,
    stoppedAt: Date,
    stopReason: String,
    durationSeconds: Number,
    providerResourceId: String,
    providerSid: String,
    fileKey: String,
    fileUrl: String,
    retentionUntil: Date,
    error: String,
  },
  { timestamps: true }
);

recordingSchema.index({ status: 1, retentionUntil: 1 });

module.exports = mongoose.model('Recording', recordingSchema);