const IST = '+05:30';
exports.IST = IST;
exports.DAY = 86400000;
exports.todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
exports.addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
exports.dayOfWeek = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
exports.at = (ymd, hm) => new Date(`${ymd}T${hm}:00${IST}`);
exports.isYMD = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(new Date(`${s}T00:00:00Z`));