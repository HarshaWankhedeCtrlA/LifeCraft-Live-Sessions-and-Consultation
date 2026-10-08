const Slot = require('../models/Slot');

const IST = '+05:30';
const DAY = 24 * 60 * 60 * 1000;
const istDate = (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);

// GET /sessions/calendar?mentorId=&date=YYYY-MM-DD | from=&to=&duration=
exports.getCalendar = async (req, res) => {
  const { mentorId, date, from, to, duration } = req.query;
  const now = new Date();
  let start, end;

  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ success: false, message: 'date must be YYYY-MM-DD' });
    start = new Date(`${date}T00:00:00${IST}`);
    end = new Date(start.getTime() + DAY);
  } else {
    start = from ? new Date(from) : now;
    end = to ? new Date(to) : new Date(start.getTime() + 7 * DAY);
  }
  if (isNaN(start) || isNaN(end) || end <= start)
    return res.status(400).json({ success: false, message: 'Invalid date range' });
  if (end - start > 31 * DAY)
    return res.status(400).json({ success: false, message: 'Range cannot exceed 31 days' });
  if (start < now) start = now;

  const filter = { status: 'available', startTime: { $gte: start, $lt: end } };
  if (mentorId) filter.mentorId = mentorId;
  if (duration) filter.durationMinutes = Number(duration);

  const slots = await Slot.find(filter).sort({ startTime: 1 }).limit(1000).lean();

  const days = {};
  for (const s of slots) {
    (days[istDate(s.startTime)] ||= []).push({
      slotId: s._id,
      mentorId: s.mentorId,
      startTime: s.startTime,
      endTime: s.endTime,
      durationMinutes: s.durationMinutes,
    });
  }
  res.json({
    success: true,
    timezone: 'Asia/Kolkata',
    total: slots.length,
    data: Object.entries(days).map(([d, items]) => ({ date: d, slots: items })),
  });
};

// GET /sessions/calendar/dates?month=YYYY-MM&mentorId=  (for calendar dots)
exports.getAvailableDates = async (req, res) => {
  const { month, mentorId } = req.query;
  if (!/^\d{4}-\d{2}$/.test(month || ''))
    return res.status(400).json({ success: false, message: 'month must be YYYY-MM' });

  const start = new Date(`${month}-01T00:00:00${IST}`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);

  const match = { status: 'available', startTime: { $gte: new Date(Math.max(start, Date.now())), $lt: end } };
  if (mentorId) match.mentorId = mentorId;

  const rows = await Slot.aggregate([
    { $match: match },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$startTime', timezone: IST } }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  res.json({ success: true, data: rows.map((r) => ({ date: r._id, availableSlots: r.count })) });
};

// POST /sessions/slots  (mentor/admin) - temporary seeding until Sr 4
exports.createSlots = async (req, res) => {
  const allowed = (process.env.SLOT_DURATIONS || '30,45,60').split(',').map(Number);
  const mentorId = req.user.role === 'admin' && req.body.mentorId ? req.body.mentorId : req.user.id;
  const input = Array.isArray(req.body.slots) ? req.body.slots : [];
  if (!input.length || input.length > 200)
    return res.status(400).json({ success: false, message: 'Provide 1-200 slots' });

  const docs = [];
  for (const s of input) {
    const startTime = new Date(s.startTime);
    const dur = Number(s.durationMinutes);
    if (isNaN(startTime) || startTime <= new Date())
      return res.status(400).json({ success: false, message: 'startTime must be a valid future time' });
    if (!allowed.includes(dur))
      return res.status(400).json({ success: false, message: `durationMinutes must be one of ${allowed}` });
    docs.push({ mentorId, startTime, endTime: new Date(startTime.getTime() + dur * 60000), durationMinutes: dur });
  }

  try {
    const created = await Slot.insertMany(docs, { ordered: false });
    res.status(201).json({ success: true, created: created.length });
  } catch (e) {
    if (e.code === 11000 || e.writeErrors) // duplicates skipped
      return res.status(201).json({ success: true, created: e.insertedDocs?.length || 0, note: 'Duplicate slots skipped' });
    throw e;
  }
};