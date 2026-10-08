const Availability = require('../models/Availability');
const Slot = require('../models/Slot');
const Booking = require('../models/Booking');
const { generateForMentor } = require('../services/slotGenerator');
const { todayIST, addDays, at, isYMD } = require('../services/time');

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const mins = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const durations = () => (process.env.SLOT_DURATIONS || '30,45,60').split(',').map(Number);
const owner = (req) => {
  const o = req.body?.mentorId || req.query?.mentorId;
  return req.user.role === 'admin' && o ? String(o) : req.user.id;
};
const bad = (res, message) => res.status(400).json({ success: false, message });
const dayRange = (d) => ({ startTime: { $gte: at(d, '00:00'), $lt: at(addDays(d, 1), '00:00') } });

// PUT /sessions/availability/me
// { windows:[{dayOfWeek:0-6 (0=Sun), startTime:"10:00", endTime:"13:00", durationMinutes:30}],
//   bufferMinutes?, horizonDays?, replaceFuture? }
exports.setAvailability = async (req, res) => {
  const mentorId = owner(req);
  const { windows, bufferMinutes = 0, horizonDays = 30, replaceFuture = true } = req.body;
  const buf = Number(bufferMinutes);
  const hor = Number(horizonDays);
  if (!Array.isArray(windows) || windows.length > 30) return bad(res, 'windows must be an array (max 30)');
  if (!Number.isInteger(buf) || buf < 0 || buf > 60) return bad(res, 'bufferMinutes must be 0-60');
  if (!Number.isInteger(hor) || hor < 1 || hor > 60) return bad(res, 'horizonDays must be 1-60');

  const clean = [];
  for (const w of windows) {
    const day = Number(w.dayOfWeek);
    const dur = Number(w.durationMinutes);
    if (!Number.isInteger(day) || day < 0 || day > 6) return bad(res, 'dayOfWeek must be 0-6');
    if (!HM.test(w.startTime) || !HM.test(w.endTime) || mins(w.endTime) <= mins(w.startTime))
      return bad(res, 'startTime/endTime must be HH:mm and end after start');
    if (!durations().includes(dur)) return bad(res, `durationMinutes must be one of ${durations()}`);
    if (mins(w.endTime) - mins(w.startTime) < dur) return bad(res, 'Window is shorter than the session duration');
    clean.push({ dayOfWeek: day, startTime: w.startTime, endTime: w.endTime, durationMinutes: dur });
  }
  for (let d = 0; d < 7; d++) {
    const ws = clean.filter((w) => w.dayOfWeek === d).sort((a, b) => mins(a.startTime) - mins(b.startTime));
    for (let i = 1; i < ws.length; i++)
      if (mins(ws[i].startTime) < mins(ws[i - 1].endTime)) return bad(res, `Overlapping windows on day ${d}`);
  }

  const doc = await Availability.findOneAndUpdate(
    { mentorId },
    { $set: { windows: clean, bufferMinutes: buf, horizonDays: hor, isActive: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Rules changed: drop future UNBOOKED slots and rebuild (booked slots are never touched)
  if (replaceFuture) await Slot.deleteMany({ mentorId, status: 'available', startTime: { $gt: new Date() } });
  const generated = await generateForMentor(doc, hor);
  res.json({ success: true, data: doc, generated });
};

// GET /sessions/availability/me
exports.getAvailability = async (req, res) => {
  const doc = await Availability.findOne({ mentorId: owner(req) }).lean();
  res.json({ success: true, data: doc || { windows: [], holidays: [], bufferMinutes: 0, horizonDays: 30 } });
};

// POST /sessions/availability/generate  { days? }
exports.generate = async (req, res) => {
  const doc = await Availability.findOne({ mentorId: owner(req) });
  if (!doc || !doc.windows.length) return bad(res, 'Set working hours first');
  res.json({ success: true, generated: await generateForMentor(doc, req.body.days) });
};

// POST /sessions/availability/holidays  { dates:["2026-10-20"], reason? }
exports.addHolidays = async (req, res) => {
  const mentorId = owner(req);
  const { dates, reason = '' } = req.body;
  if (!Array.isArray(dates) || !dates.length || dates.length > 60 || !dates.every(isYMD))
    return bad(res, 'dates must be 1-60 values in YYYY-MM-DD');
  if (dates.some((d) => d < todayIST())) return bad(res, 'Holidays cannot be in the past');

  const doc = await Availability.findOneAndUpdate({ mentorId }, { $setOnInsert: { mentorId } }, { upsert: true, new: true });
  const have = new Set(doc.holidays.map((h) => h.date));
  const fresh = [...new Set(dates)].filter((d) => !have.has(d));
  if (fresh.length) {
    doc.holidays.push(...fresh.map((date) => ({ date, reason: String(reason).slice(0, 100) })));
    await doc.save();
  }

  const ranges = [...new Set(dates)].map(dayRange);
  const blocked = await Slot.updateMany({ mentorId, status: 'available', $or: ranges }, { $set: { status: 'blocked' } });
  // Already-booked sessions are not cancelled automatically; mentor must handle them
  const affected = await Booking.find({ mentorId, status: 'confirmed', $or: ranges }).select('_id startTime userId').lean();
  res.json({ success: true, holidays: doc.holidays, slotsBlocked: blocked.modifiedCount, bookingsNeedingAction: affected });
};

// DELETE /sessions/availability/holidays/:date
exports.removeHoliday = async (req, res) => {
  const mentorId = owner(req);
  const { date } = req.params;
  if (!isYMD(date)) return bad(res, 'date must be YYYY-MM-DD');
  const doc = await Availability.findOneAndUpdate({ mentorId }, { $pull: { holidays: { date } } }, { new: true });
  if (!doc) return res.status(404).json({ success: false, message: 'No availability set' });
  const reopened = await Slot.updateMany(
    { mentorId, status: 'blocked', ...dayRange(date), startTime: { $gt: new Date(), $gte: at(date, '00:00'), $lt: at(addDays(date, 1), '00:00') } },
    { $set: { status: 'available' } }
  );
  res.json({ success: true, holidays: doc.holidays, slotsReopened: reopened.modifiedCount });
};