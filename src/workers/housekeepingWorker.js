const Extension = require('../models/Extension');
const Recording = require('../models/Recording');

exports.housekeeping = async () => {
  const now = new Date();
  const ext = await Extension.updateMany({ status: 'requested', expiresAt: { $lte: now } }, { $set: { status: 'expired' } });
  // Retention: mark expired here; delete the stored file through your storage/provider (Sr 18 / Media module)
  const rec = await Recording.updateMany(
    { status: 'ready', retentionUntil: { $lte: now } },
    { $set: { status: 'expired', fileUrl: null } }
  );
  return { extensionsExpired: ext.modifiedCount, recordingsExpired: rec.modifiedCount };
};