const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    fromUserId: { type: String, required: true },
    toUserId: { type: String, required: true, index: true },
    fromRole: { type: String, enum: ['seeker', 'mentor'], required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true }
);

// one feedback per person per session
feedbackSchema.index({ bookingId: 1, fromUserId: 1 }, { unique: true });

module.exports = mongoose.model('Feedback', feedbackSchema);