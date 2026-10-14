const router = require('express').Router();
const c = require('../controller/feedbackController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);
router.get('/feedback/mentor/:mentorId', c.mentorSummary);

module.exports = router;