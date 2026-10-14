const mongoose = require('mongoose');

const intervalSchema = new mongoose.Schema(
  { joinedAt: { type: Date, required: true }, leftAt: Date },
  { _id: false }
);

const attendanceSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    userId: { type: String, required: true },
    role: { type: String, enum: ['seeker', 'mentor'], required: true },
    intervals: [intervalSchema], // one entry per join/leave, so reconnects are recorded
    firstJoinedAt: Date,
    lastLeftAt: Date,
    totalSeconds: { type: Number, default: 0 }, // closed intervals only
  },
  { timestamps: true }
);

attendanceSchema.index({ bookingId: 1, userId: 1 }, { unique: true });

function recompute(doc) {
  let total = 0;
  let last = null;
  for (const i of doc.intervals) {
    if (i.leftAt) {
      total += Math.max(0, Math.round((i.leftAt - i.joinedAt) / 1000));
      if (!last || i.leftAt > last) last = i.leftAt;
    }
  }
  doc.totalSeconds = total;
  doc.lastLeftAt = last || undefined;
}

function closeOpen(doc, at) {
  const open = doc.intervals[doc.intervals.length - 1];
  if (open && !open.leftAt) {
    open.leftAt = at;
    recompute(doc);
    return true;
  }
  return false;
}

// Call when someone joins the video session. Safe to call twice (a second call while still "in" does nothing).
attendanceSchema.statics.recordJoin = async function (bookingId, userId, role) {
  const now = new Date();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let doc = await this.findOne({ bookingId, userId });
      if (!doc) doc = new this({ bookingId, userId, role, firstJoinedAt: now, intervals: [] });
      const last = doc.intervals[doc.intervals.length - 1];
      if (!last || last.leftAt) doc.intervals.push({ joinedAt: now });
      await doc.save();
      return doc;
    } catch (err) {
      if (err.code !== 11000 || attempt === 1) throw err; // two simultaneous first joins: retry once
    }
  }
};

attendanceSchema.statics.recordLeave = async function (bookingId, userId, at = new Date()) {
  const doc = await this.findOne({ bookingId, userId });
  if (!doc) return null;
  if (closeOpen(doc, at)) await doc.save();
  return doc;
};

// Call when the session ends (manual end or auto-close) so nobody stays "in" forever.
attendanceSchema.statics.closeAll = async function (bookingId, at = new Date()) {
  const docs = await this.find({ bookingId });
  for (const doc of docs) {
    if (closeOpen(doc, at)) await doc.save();
  }
};

module.exports = mongoose.model('Attendance', attendanceSchema);