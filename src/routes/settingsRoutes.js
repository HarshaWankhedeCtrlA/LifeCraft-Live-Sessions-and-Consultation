const router = require('express').Router();
const rec = require('../controller/recordingController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('admin', 'mentor', 'lifecrafter'));
router.get('/me', rec.getSettings);
router.put('/me', rec.putSettings);

module.exports = router;