const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));
const prefix = process.env.API_PREFIX || '/api/v1';
app.post(`${prefix}/sessions/webhooks/recording`, require('./controller/recordingController').webhook);
app.use(`${prefix}/sessions/settings`, require('./routes/settingsRoutes'));
app.use(`${prefix}/sessions/live`, require('./routes/liveRoutes'));
app.use(`${prefix}/sessions`, require('./routes/calendarRoutes'));
app.use(`${prefix}/sessions`, require('./routes/bookingRoutes'));
app.use(`${prefix}/sessions`, require('./routes/pricingRoutes'));
app.use(`${prefix}/sessions`, require('./routes/availabilityRoutes')); // keep last (mentor-only gate) // keep last (mentor-only gate)

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use((req, res) => res.status(404).json({ success: false, message: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ success: false, message: 'Server error' });
});

module.exports = app;