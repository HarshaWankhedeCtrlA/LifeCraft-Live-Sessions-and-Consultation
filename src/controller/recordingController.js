const crypto = require('crypto');
const Recording = require('../models/Recording');
const MentorSetting = require('../models/MentorSetting');
const rs = require('../services/recordingService');
const { clockFor } = require('../services/sessionService');
const { loadSession, fail } = require('../services/sessionAccess');

const view = (rec, role) => ({
  policy: rec.policy,
  status: rec.status,
  notice: rs.notice(rec),
  consent: { mentor: rec.consent.mentor, seeker: rec.consent.seeker },
  yourConsent: role ? rec.consent[role] : null,
  startedAt: rec.startedAt, stoppedAt: rec.stoppedAt, durationSeconds: rec.durationSeconds,
});

const getRec = (s) => rs.ensureRecording({ _id: s.bookingId, mentorId: s.mentorId, userId: s.userId });

// GET /sessions/live/:bookingId/recording
exports.status = async (req, res) => {
  const ctx = await loadSession(req, res, { admin: true });
  if (!ctx) return;
  res.json({ success: true, data: view(await getRec(ctx.s), ctx.role) });
};

// POST /sessions/live/:bookingId/recording/consent  { consent: true|false }
exports.consent = async (req, res) => {
  const ctx = await loadSession(req, res);
  if (!ctx) return;
  if (typeof req.body.consent !== 'boolean') return fail(res, 400, 'consent must be true or false');
  const rec = await getRec(ctx.s);
  if (rec.policy !== 'on_consent') return fail(res, 400, 'Consent is not used for this session');
  const phase = clockFor(ctx.s).phase;
  if (phase === 'ended' || phase === 'cancelled') return fail(res, 410, 'Session is over');

  const updated = await Recording.findOneAndUpdate(
    { _id: rec._id }, { $set: { [`consent.${ctx.role}`]: req.body.consent } }, { new: true }
  );
  // Withdrawing consent during a recording stops it and the result is discarded
  if (!req.body.consent && updated.status === 'recording') await rs.stop(updated.bookingId, 'consent_withdrawn');
  res.json({ success: true, data: view(await Recording.findById(rec._id), ctx.role) });
};

// POST /sessions/live/:bookingId/recording/start | stop   (mentor or admin)
exports.start = async (req, res) => {
  const ctx = await loadSession(req, res, { admin: true });
  if (!ctx) return;
  if (ctx.role !== 'mentor' && req.user.role !== 'admin') return fail(res, 403, 'Only the mentor can start recording');
  if (ctx.s.status !== 'live' || clockFor(ctx.s).phase !== 'in_progress') return fail(res, 400, 'Session is not live');

  const rec = await getRec(ctx.s);
  if (rec.policy === 'off') return fail(res, 403, 'Recording is disabled for this session');
  if (!rs.canStart(rec))
    return fail(res, 403, 'Both participants must consent first', { consent: rec.consent });
  if (rec.status !== 'not_started') return fail(res, 409, `Recording is already ${rec.status}`);
  try {
    await rs.start(rec);
  } catch (e) {
    return fail(res, 502, 'Could not start recording', { detail: e.message });
  }
  res.json({ success: true, data: view(await Recording.findById(rec._id), ctx.role) });
};

exports.stop = async (req, res) => {
  const ctx = await loadSession(req, res, { admin: true });
  if (!ctx) return;
  if (ctx.role !== 'mentor' && req.user.role !== 'admin') return fail(res, 403, 'Only the mentor can stop recording');
  const done = await rs.stop(ctx.s.bookingId, 'stopped_by_mentor');
  if (!done) return fail(res, 409, 'No recording in progress');
  res.json({ success: true, data: view(await Recording.findOne({ bookingId: ctx.s.bookingId }), ctx.role) });
};

// GET /sessions/live/:bookingId/recording/playback
exports.playback = async (req, res) => {
  const ctx = await loadSession(req, res, { admin: true });
  if (!ctx) return;
  const rec = await Recording.findOne({ bookingId: ctx.s.bookingId }).lean();
  if (!rec || rec.status !== 'ready') return fail(res, 404, 'Recording not available');
  // In production return a short-lived signed URL from your storage/CDN instead of a permanent link
  res.json({ success: true, data: { url: rec.fileUrl, durationSeconds: rec.durationSeconds, retentionUntil: rec.retentionUntil } });
};

// POST /sessions/webhooks/recording  (video provider or your recording worker; internal key)
exports.webhook = async (req, res) => {
  const key = process.env.INTERNAL_API_KEY || '';
  const got = String(req.headers['x-internal-api-key'] || '');
  const ok = key && got.length === key.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(key));
  if (!ok) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const { bookingId, status, fileKey, fileUrl, error } = req.body;
  const rec = await Recording.findOne({ bookingId, status: 'processing' });
  if (!rec) return res.status(404).json({ success: false, message: 'No recording is processing for this booking' });

  const discard = rec.stopReason === 'consent_withdrawn';
  const set = status === 'ready'
    ? discard
      ? { status: 'discarded', fileKey: null, fileUrl: null }   // delete the stored file as well
      : { status: 'ready', fileKey, fileUrl, retentionUntil: new Date(Date.now() + Number(process.env.RECORDING_RETENTION_DAYS || 90) * 86400000) }
    : { status: 'failed', error: String(error || 'unknown').slice(0, 300) };
  await Recording.updateOne({ _id: rec._id }, { $set: set });
  res.json({ success: true });
};

// ---- Mentor settings: GET/PUT /sessions/settings/me --------------------------------
exports.getSettings = async (req, res) => {
  const s = await MentorSetting.findOne({ mentorId: req.user.id }).lean();
  res.json({
    success: true,
    data: { recordingMode: s?.recordingMode || 'off', fileSharing: s?.fileSharing !== false },
    platform: { recordingMode: process.env.RECORDING_MODE || 'optional', fileSharing: process.env.FILE_SHARING_ENABLED !== 'false' },
  });
};

exports.putSettings = async (req, res) => {
  const set = {};
  if (req.body.recordingMode !== undefined) {
    if (!['off', 'on_consent'].includes(req.body.recordingMode)) return fail(res, 400, 'recordingMode must be off or on_consent');
    set.recordingMode = req.body.recordingMode;
  }
  if (req.body.fileSharing !== undefined) {
    if (typeof req.body.fileSharing !== 'boolean') return fail(res, 400, 'fileSharing must be true or false');
    set.fileSharing = req.body.fileSharing;
  }
  if (!Object.keys(set).length) return fail(res, 400, 'Nothing to update');
  const doc = await MentorSetting.findOneAndUpdate({ mentorId: req.user.id }, { $set: set }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
  res.json({ success: true, data: doc });
};