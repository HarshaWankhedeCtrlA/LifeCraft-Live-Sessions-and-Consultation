const mongoose = require('mongoose');

const pricingSchema = new mongoose.Schema(
  {
    mentorId: { type: String, required: true, unique: true },
    currency: { type: String, default: 'INR' },
    prices: [{ _id: false, durationMinutes: Number, amount: Number }],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Pricing', pricingSchema);