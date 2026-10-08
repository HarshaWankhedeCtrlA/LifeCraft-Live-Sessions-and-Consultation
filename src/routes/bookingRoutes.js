const router = require('express').Router();
const c = require('../controller/bookingController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);
router.post('/bookings', c.createBooking);
router.get('/bookings/me', c.myBookings('userId'));
router.get('/bookings/mentor', requireRole('admin', 'mentor', 'lifecrafter'), c.myBookings('mentorId'));
router.get('/bookings/:id', c.getBooking);        // keep after /me and /mentor
router.post('/bookings/:id/cancel', c.cancelBooking);

module.exports = router;