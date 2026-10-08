const mongoose = require('mongoose');

const presenceSchema = new mongoose.Schema(
  { waitingJoinedAt: Date, lastSeenAt: Date, joinedAt: Date },
  { _id: false }
);

const liveSessionSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
    mentorId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    roomName: String,
    scheduledStart: { type: Date, required: true },
    scheduledEnd: { type: Date, required: true },
    endsAt: { type: Date, required: true },          // scheduledStart + purchased + extension time
    purchasedSeconds: { type: Number, required: true },
    extraSeconds: { type: Number, default: 0 },      // filled by Sr 11 (paid extension)
    status: { type: String, enum: ['scheduled', 'live', 'ended', 'cancelled'], default: 'scheduled' },
    actualStart: Date,
    actualEnd: Date,
    endReason: String,
    presence: { mentor: presenceSchema, seeker: presenceSchema },
  },
  { timestamps: true }
);

liveSessionSchema.index({ status: 1, endsAt: 1 });

module.exports = mongoose.model('LiveSession', liveSessionSchema);