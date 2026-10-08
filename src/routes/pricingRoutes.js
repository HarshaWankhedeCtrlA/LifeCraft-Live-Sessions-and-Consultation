const router = require('express').Router();
const c = require('../controller/pricingController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);
router.put('/pricing/me', requireRole('admin', 'mentor', 'lifecrafter'), c.setMyPricing);
router.get('/pricing/me', requireRole('admin', 'mentor', 'lifecrafter'), c.getMyPricing);
router.get('/pricing/quote', c.quote);
router.get('/pricing/mentor/:mentorId', c.getMentorPricing);

module.exports = router;