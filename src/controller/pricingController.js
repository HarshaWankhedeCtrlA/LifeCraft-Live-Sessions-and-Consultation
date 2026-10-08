const Pricing = require('../models/Pricing');
const { getPrice } = require('../services/pricingService');

const bad = (res, message) => res.status(400).json({ success: false, message });

// PUT /sessions/pricing/me  { prices:[{durationMinutes, amount}] }
exports.setMyPricing = async (req, res) => {
  const mentorId = req.user.role === 'admin' && req.body.mentorId ? String(req.body.mentorId) : req.user.id;
  const { prices } = req.body;
  if (!Array.isArray(prices) || !prices.length || prices.length > 10) return bad(res, 'Provide 1-10 prices');

  const seen = new Set();
  const clean = [];
  for (const p of prices) {
    const d = Number(p.durationMinutes);
    const a = Number(p.amount);
    if (!Number.isInteger(d) || d < 10 || d > 240 || d % 5) return bad(res, 'durationMinutes must be 10-240 in steps of 5');
    if (seen.has(d)) return bad(res, `Duplicate duration ${d}`);
    if (!Number.isFinite(a) || a < 0 || a > 100000) return bad(res, 'amount must be between 0 and 100000');
    seen.add(d);
    clean.push({ durationMinutes: d, amount: Math.round(a * 100) / 100 });
  }
  clean.sort((x, y) => x.durationMinutes - y.durationMinutes);

  const doc = await Pricing.findOneAndUpdate(
    { mentorId },
    { $set: { prices: clean, currency: 'INR' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  res.json({ success: true, data: doc });
};

// GET /sessions/pricing/me
exports.getMyPricing = async (req, res) => {
  const doc = await Pricing.findOne({ mentorId: req.user.id }).lean();
  res.json({ success: true, data: doc || { mentorId: req.user.id, currency: 'INR', prices: [] } });
};

// GET /sessions/pricing/mentor/:mentorId
exports.getMentorPricing = async (req, res) => {
  const doc = await Pricing.findOne({ mentorId: req.params.mentorId }).lean();
  res.json({ success: true, data: doc || { mentorId: req.params.mentorId, currency: 'INR', prices: [] } });
};

// GET /sessions/pricing/quote?mentorId=&duration=
exports.quote = async (req, res) => {
  const { mentorId } = req.query;
  const duration = Number(req.query.duration);
  if (!mentorId || !Number.isInteger(duration)) return bad(res, 'mentorId and duration required');
  const price = await getPrice(mentorId, duration);
  if (!price) return res.status(404).json({ success: false, message: 'Pricing not available for this duration' });
  res.json({ success: true, data: { mentorId, durationMinutes: duration, ...price, taxNote: 'GST added at checkout' } });
};