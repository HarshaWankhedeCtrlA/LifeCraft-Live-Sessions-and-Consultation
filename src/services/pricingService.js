const Pricing = require('../models/Pricing');

const defaults = () =>
  Object.fromEntries(
    (process.env.DEFAULT_PRICES || '')
      .split(',').filter(Boolean)
      .map((p) => p.split(':').map(Number))
  );

// Mentor price -> platform default -> free (only if allowed) -> null
exports.getPrice = async (mentorId, durationMinutes) => {
  const p = await Pricing.findOne({ mentorId }).lean();
  const hit = p?.prices.find((x) => x.durationMinutes === durationMinutes);
  if (hit) return { amount: hit.amount, currency: p.currency, source: 'mentor' };
  const d = defaults()[durationMinutes];
  if (d !== undefined) return { amount: d, currency: 'INR', source: 'default' };
  if (process.env.ALLOW_UNPRICED_BOOKING === 'true') return { amount: 0, currency: 'INR', source: 'unpriced' };
  return null;
};