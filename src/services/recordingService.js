const Recording = require('../models/Recording');
const MentorSetting = require('../models/MentorSetting');
const video = require('./videoProvider');

exports.effectivePolicy = async (mentorId) => {
  const mode = process.env.RECORDING_MODE || 'optional';
  if (mode === 'off') return 'off';
  if (mode === 'always') return 'always';
  const s = await MentorSetting.findOne({ mentorId }).lean();
  return s?.recordingMode || 'off';
};

// b = { _id: bookingId, mentorId, userId }. Idempotent; the first call snapshots the policy.
exports.ensureRecording = async (b) => {
  const policy = await exports.effectivePolicy(b.mentorId);
  await Recording.updateOne(
    { bookingId: b._id },
    { $setOnInsert: { mentorId: b.mentorId, userId: b.userId, policy, status: policy === 'off' ? 'disabled' : 'not_started' } },
    { upsert: true }
  );
  return Recording.findOne({ bookingId: b._id });
};

exports.notice = (rec) =>
  rec.policy === 'always' ? 'This session will be recorded.'
  : rec.policy === 'on_consent' ? 'This session is recorded only if both of you consent.'
  : 'This session is not recorded.';

exports.canStart = (rec) =>
  rec.policy === 'always' || (rec.policy === 'on_consent' && rec.consent.mentor === true && rec.consent.seeker === true);

exports.start = async (rec) => {
  const claimed = await Recording.findOneAndUpdate(
    { _id: rec._id, status: 'not_started' },
    { $set: { status: 'recording', startedAt: new Date() } },
    { new: true }
  );
  if (!claimed) return null;
  try {
    const r = await video.startRecording({ roomName: `lc_${rec.bookingId}` });
    await Recording.updateOne({ _id: rec._id }, { $set: { providerResourceId: r.resourceId, providerSid: r.sid } });
  } catch (e) {
    await Recording.updateOne({ _id: rec._id }, { $set: { status: 'failed', error: e.message } });
    throw e;
  }
  return claimed;
};

exports.stop = async (bookingId, reason = 'stopped') => {
  const rec = await Recording.findOneAndUpdate(
    { bookingId, status: 'recording' },
    { $set: { status: 'processing', stoppedAt: new Date(), stopReason: reason } },
    { new: false }
  );
  if (!rec) return null;
  const durationSeconds = Math.round((Date.now() - +rec.startedAt) / 1000);
  try {
    await video.stopRecording({ roomName: `lc_${bookingId}`, resourceId: rec.providerResourceId, sid: rec.providerSid });
    await Recording.updateOne({ _id: rec._id }, { $set: { durationSeconds } });
  } catch (e) {
    await Recording.updateOne({ _id: rec._id }, { $set: { status: 'failed', error: e.message, durationSeconds } });
  }
  return rec;
};

// Called when someone joins a live session (policy "always")
exports.autoStart = async (bookingId, s) => {
  const rec = await exports.ensureRecording({ _id: bookingId, mentorId: s.mentorId, userId: s.userId });
  if (rec.policy === 'always' && rec.status === 'not_started') await exports.start(rec);
};