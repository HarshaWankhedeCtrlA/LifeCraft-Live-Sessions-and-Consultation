const router = require('express').Router();
const room = require('../controller/roomController');
const conf = require('../controller/confirmationController');
const ext = require('../controller/extensionController');
const rec = require('../controller/recordingController');
const chatC = require('../controller/chatController');
const files = require('../controller/fileController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

router.get('/admin/reminders', requireRole('admin'), conf.listReminders);
router.post('/admin/reminders/run', requireRole('admin'), conf.runNow);

router.get('/:bookingId/confirmation', conf.confirmation);
router.get('/:bookingId/waiting-room', room.waitingRoomStatus);
router.post('/:bookingId/waiting-room/join', room.joinWaitingRoom);
router.post('/:bookingId/join', room.joinSession);
router.get('/:bookingId/clock', room.clock);
router.post('/:bookingId/end', room.endSession);

// Sr 11
router.post('/:bookingId/extensions', ext.request);
router.get('/:bookingId/extensions', ext.list);
router.post('/:bookingId/extensions/:extId/approve', ext.decide('approve'));
router.post('/:bookingId/extensions/:extId/reject', ext.decide('reject'));
router.post('/:bookingId/extensions/:extId/cancel', ext.cancel);

// Sr 12
router.get('/:bookingId/recording', rec.status);
router.post('/:bookingId/recording/consent', rec.consent);
router.post('/:bookingId/recording/start', rec.start);
router.post('/:bookingId/recording/stop', rec.stop);
router.get('/:bookingId/recording/playback', rec.playback);

// Sr 13
router.post('/:bookingId/chat', chatC.send);
router.get('/:bookingId/chat', chatC.history);

// Sr 14
router.post('/:bookingId/files', files.precheck, files.receive, files.upload);
router.get('/:bookingId/files', files.list);
router.get('/:bookingId/files/:fileId/download', files.download);
router.delete('/:bookingId/files/:fileId', files.remove);

module.exports = router;