const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, required: true },
    senderId: { type: String, required: true },
    senderRole: { type: String, enum: ['seeker', 'mentor', 'system'], required: true },
    type: { type: String, enum: ['text', 'file', 'system'], default: 'text' },
    text: { type: String, maxlength: 2000 },
    fileId: { type: mongoose.Schema.Types.ObjectId, default: null },
    clientMessageId: { type: String, maxlength: 64 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

chatMessageSchema.index({ bookingId: 1, _id: 1 });
// A retried send with the same clientMessageId never creates a second message
chatMessageSchema.index(
  { bookingId: 1, senderId: 1, clientMessageId: 1 },
  { unique: true, partialFilterExpression: { clientMessageId: { $type: 'string' } } }
);

module.exports = mongoose.model('ChatMessage', chatMessageSchema);