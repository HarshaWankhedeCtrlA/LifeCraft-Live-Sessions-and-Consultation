const { runReminders } = require('./reminderWorker');
const { autoClose } = require('./autoCloseWorker');
const { topUpSlots } = require('./slotWorker');
const { housekeeping } = require('./housekeepingWorker');
const every = (name, ms, fn) => {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try { await fn(); } catch (e) { console.error(`[worker:${name}]`, e.message); } finally { busy = false; }
  };
  setInterval(run, ms);
  return run;
};

exports.start = () => {
  if (process.env.WORKERS_ENABLED === 'false') return console.log('Workers disabled');
  every('reminders', 30 * 1000, runReminders);
  every('autoClose', Number(process.env.AUTOCLOSE_INTERVAL_SECONDS || 15) * 1000, autoClose);
  every('housekeeping', 60 * 1000, housekeeping);
  const top = every('slots', 6 * 3600 * 1000, topUpSlots);
  setTimeout(top, 10000);
  console.log('Workers started');
};