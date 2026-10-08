const router = require('express').Router();
const c = require('../controller/calendarController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);
router.get('/calendar', c.getCalendar);
router.get('/calendar/dates', c.getAvailableDates);
router.post('/slots', requireRole('admin', 'mentor', 'lifecrafter'), c.createSlots);

module.exports = router;