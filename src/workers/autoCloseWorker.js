const LiveSession = require('../models/LiveSession');
const { closeSession } = require('../services/sessionService');

// Ends every session whose allocated time has expired. Atomic, so multiple instances are safe.
exports.autoClose = async () => {
  let ended = 0;
  for (let i = 0; i < 100; i++) {
    const next = await LiveSession.findOne({ status: { $in: ['scheduled', 'live'] }, endsAt: { $lte: new Date() } }).select('_id').lean();
    if (!next) break;
    if (await closeSession({ _id: next._id, endsAt: { $lte: new Date() } }, 'time_expired')) ended++;
  }
  return { ended };
};