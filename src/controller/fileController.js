const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const multer = require('multer');
const SessionFile = require('../models/SessionFile');
const MentorSetting = require('../models/MentorSetting');
const chat = require('../services/chatService');
const { loadSession, fail } = require('../services/sessionAccess');

const ROOT = path.resolve(process.env.UPLOAD_DIR || 'uploads/sessions');
const allowedExt = () => (process.env.FILE_ALLOWED_EXT || 'pdf,png,jpg,jpeg,docx,pptx,xlsx,txt').split(',').map((s) => s.trim().toLowerCase());
const extOf = (n) => path.extname(n).slice(1).toLowerCase();
const cleanName = (n) => path.basename(n).replace(/[^\w. -]/g, '_').slice(-100);

const SIG = {
  pdf: [0x25, 0x50, 0x44, 0x46],
  png: [0x89, 0x50, 0x4e, 0x47],
  jpg: [0xff, 0xd8, 0xff],
  jpeg: [0xff, 0xd8, 0xff],
  docx: [0x50, 0x4b, 0x03, 0x04],
  pptx: [0x50, 0x4b, 0x03, 0x04],
  xlsx: [0x50, 0x4b, 0x03, 0x04],
};
async function looksValid(filePath, ext) {
  if (ext === 'txt') return !(await fs.promises.readFile(filePath)).includes(0);
  const sig = SIG[ext];
  if (!sig) return false; // an extension we have no signature for is not accepted
  const fd = await fs.promises.open(filePath, 'r');
  const buf = Buffer.alloc(8);
  await fd.read(buf, 0, 8, 0);
  await fd.close();
  return sig.every((b, i) => buf[i] === b);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _f, cb) => {
      const dir = path.join(ROOT, req.params.bookingId); // bookingId was validated as an ObjectId in precheck
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => cb(null, `${crypto.randomBytes(16).toString('hex')}.${extOf(file.originalname)}`),
  }),
  limits: { fileSize: Number(process.env.FILE_MAX_MB || 10) * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    allowedExt().includes(extOf(file.originalname)) ? cb(null, true) : cb(Object.assign(new Error('File type not allowed'), { code: 'BAD_TYPE' })),
});

const permitted = async (mentorId) => {
  if (process.env.FILE_SHARING_ENABLED === 'false') return false;
  const s = await MentorSetting.findOne({ mentorId }).lean();
  return s?.fileSharing !== false;
};

// 1) checks everything BEFORE the file is accepted
exports.precheck = async (req, res, next) => {
  const ctx = await loadSession(req, res);
  if (!ctx) return;
  if (!chat.isOpen(ctx.s)) return fail(res, 403, 'Files can be shared only while the session chat is open');
  if (!(await permitted(ctx.s.mentorId))) return fail(res, 403, 'File sharing is not permitted for this session');
  const count = await SessionFile.countDocuments({ bookingId: ctx.s.bookingId, deletedAt: null });
  if (count >= Number(process.env.FILE_MAX_PER_SESSION || 20)) return fail(res, 400, 'File limit reached for this session');
  req.ctx = ctx;
  next();
};

// 2) receives the file
exports.receive = (req, res, next) =>
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return fail(res, 413, `File is larger than ${process.env.FILE_MAX_MB || 10} MB`);
    if (err.code === 'BAD_TYPE') return fail(res, 400, `Allowed types: ${allowedExt().join(', ')}`);
    return fail(res, 400, 'Upload failed');
  });

// POST /sessions/live/:bookingId/files   (multipart, field "file")
exports.upload = async (req, res) => {
  const { s, role } = req.ctx;
  if (!req.file) return fail(res, 400, 'Attach a file in the "file" field');
  const ext = extOf(req.file.filename);
  if (!(await looksValid(req.file.path, ext))) {
    await fs.promises.unlink(req.file.path).catch(() => {});
    return fail(res, 400, 'File content does not match its type');
  }
  const doc = await SessionFile.create({
    bookingId: s.bookingId, uploaderId: req.user.id, uploaderRole: role,
    originalName: cleanName(req.file.originalname), storedName: req.file.filename,
    mimeType: req.file.mimetype, size: req.file.size,
  });
  const { message } = await chat.post({ s, senderId: req.user.id, senderRole: role, type: 'file', text: doc.originalName, fileId: doc._id });
  res.status(201).json({ success: true, data: { file: doc, message } });
};

// GET /sessions/live/:bookingId/files
exports.list = async (req, res) => {
  const ctx = await loadSession(req, res, { admin: true });
  if (!ctx) return;
  const files = await SessionFile.find({ bookingId: ctx.s.bookingId, deletedAt: null }).sort({ createdAt: 1 }).select('-storedName').lean();
  res.json({ success: true, sharingPermitted: await permitted(ctx.s.mentorId), data: files });
};

// GET /sessions/live/:bookingId/files/:fileId/download
exports.download = async (req, res) => {
  const ctx = await loadSession(req, res, { admin: true });
  if (!ctx) return;
  if (!mongoose.Types.ObjectId.isValid(req.params.fileId)) return fail(res, 400, 'Invalid id');
  const f = await SessionFile.findOne({ _id: req.params.fileId, bookingId: ctx.s.bookingId, deletedAt: null });
  if (!f) return fail(res, 404, 'File not found');
  const full = path.resolve(ROOT, String(ctx.s.bookingId), f.storedName);
  if (!full.startsWith(ROOT + path.sep) || !fs.existsSync(full)) return fail(res, 404, 'File not found');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.download(full, f.originalName);
};

// DELETE /sessions/live/:bookingId/files/:fileId   (uploader or admin)
exports.remove = async (req, res) => {
  const ctx = await loadSession(req, res, { admin: true });
  if (!ctx) return;
  if (!mongoose.Types.ObjectId.isValid(req.params.fileId)) return fail(res, 400, 'Invalid id');
  const f = await SessionFile.findOne({ _id: req.params.fileId, bookingId: ctx.s.bookingId, deletedAt: null });
  if (!f) return fail(res, 404, 'File not found');
  if (f.uploaderId !== req.user.id && req.user.role !== 'admin') return fail(res, 403, 'Only the uploader can delete this file');
  f.deletedAt = new Date();
  await f.save();
  await fs.promises.unlink(path.join(ROOT, String(f.bookingId), f.storedName)).catch(() => {});
  chat.emit(f.bookingId, 'chat:file_removed', { fileId: f._id });
  res.json({ success: true });
};