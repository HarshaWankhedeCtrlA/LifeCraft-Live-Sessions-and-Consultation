const router = require('express').Router();
const c = require('../controller/availabilityController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('admin', 'mentor', 'lifecrafter'));
router.put('/availability/me', c.setAvailability);
router.get('/availability/me', c.getAvailability);
router.post('/availability/generate', c.generate);
router.post('/availability/holidays', c.addHolidays);
router.delete('/availability/holidays/:date', c.removeHoliday);

module.exports = router;