// Sends one notification through your Notifications module.
// ASSUMPTION: it accepts POST with an internal API key. Adjust URL, header and payload to match it.
exports.notify = async ({ userId, type, title, body, data = {} }) => {
  const url = process.env.NOTIFICATION_SERVICE_URL;
  if (!url) {
    console.log('[notify:dev]', userId, type, title, '-', body);
    return true;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-api-key': process.env.INTERNAL_API_KEY || '' },
    body: JSON.stringify({ userId, type, title, body, data }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Notification service responded ${res.status}`);
  return true;
};