const crypto = require('crypto');

const numericUid = (id) =>
  (parseInt(crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 8), 16) % 2147483646) + 1;

exports.createJoinCredentials = ({ roomName, userId, expiresAt }) => {
  const uid = numericUid(userId);
  const expireIn = Math.max(1, Math.floor((expiresAt - Date.now()) / 1000));

  if (process.env.VIDEO_PROVIDER === 'agora') {
    // Verify the buildTokenWithUid signature against your installed agora-token version
    const { RtcTokenBuilder, RtcRole } = require('agora-token');
    const token = RtcTokenBuilder.buildTokenWithUid(
      process.env.AGORA_APP_ID, process.env.AGORA_APP_CERTIFICATE,
      roomName, uid, RtcRole.PUBLISHER, expireIn, expireIn
    );
    return { provider: 'agora', appId: process.env.AGORA_APP_ID, channel: roomName, uid, token, expiresAt };
  }
  return { provider: 'mock', channel: roomName, uid, token: `mock-${crypto.randomBytes(8).toString('hex')}`, expiresAt };
};
// Real Agora Cloud Recording (REST) is wired in Sr 18; the mock lets you test the whole flow now.
exports.startRecording = async () => {
  if (process.env.VIDEO_PROVIDER === 'agora') throw new Error('Agora cloud recording is implemented in Sr 18');
  return { resourceId: `mock-res-${Date.now()}`, sid: `mock-sid-${Date.now()}` };
};
exports.stopRecording = async () => ({});
// Tokens expire at endsAt, which cuts access. Add a server-side kick via the provider REST API in Sr 18.
exports.endRoom = async () => {};