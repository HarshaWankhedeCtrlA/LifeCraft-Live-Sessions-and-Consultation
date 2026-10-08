const Slot = require('../models/Slot');
const { todayIST, addDays, dayOfWeek, at, DAY } = require('./time');

// Builds slots from weekly windows for today..today+days (IST). Skips holidays, past times
// and anything overlapping an existing slot of this mentor.
exports.generateForMentor = async (avail, days) => {
  const horizon = Math.min(Number(days) || avail.horizonDays, 60);
  const holidays = new Set(avail.holidays.map((h) => h.date));
  const start = todayIST();
  const existing = await Slot.find({
    mentorId: avail.mentorId,
    startTime: { $gte: new Date(Date.now() - DAY), $lt: at(addDays(start, horizon + 1), '00:00') },
  }).select('startTime endTime').lean();

  const earliest = Date.now() + 15 * 60000;
  const buffer = avail.bufferMinutes * 60000;
  const docs = [];
  let skipped = 0;

  for (let i = 0; i <= horizon; i++) {
    const ymd = addDays(start, i);
    if (holidays.has(ymd)) continue;
    for (const w of avail.windows.filter((x) => x.dayOfWeek === dayOfWeek(ymd))) {
      const step = w.durationMinutes * 60000;
      const windowEnd = at(ymd, w.endTime).getTime();
      for (let t = at(ymd, w.startTime).getTime(); t + step <= windowEnd; t += step + buffer) {
        if (t < earliest) continue;
        const s = new Date(t);
        const e = new Date(t + step);
        if (existing.some((x) => x.startTime < e && x.endTime > s)) { skipped++; continue; }
        docs.push({ mentorId: avail.mentorId, startTime: s, endTime: e, durationMinutes: w.durationMinutes });
        existing.push({ startTime: s, endTime: e });
      }
    }
  }

  let created = 0;
  if (docs.length) {
    try {
      created = (await Slot.insertMany(docs, { ordered: false })).length;
    } catch (e) {
      created = e.result?.insertedCount ?? e.insertedDocs?.length ?? 0;
    }
  }
  return { created, skipped };
};