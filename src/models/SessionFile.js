const mongoose = require('mongoose');

const sessionFileSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    uploaderId: { type: String, required: true },
    uploaderRole: { type: String, enum: ['seeker', 'mentor'], required: true },
    originalName: { type: String, required: true },
    storedName: { type: String, required: true },
    mimeType: String,
    size: Number,
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SessionFile', sessionFileSchema);