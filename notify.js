// notify.js — how Hoser reaches you (SMS via Twilio) and how your replies get back in.
//
// Sending needs a Twilio account (free trial works): set these in .env —
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (your Twilio number, +1...)
//   HOSER_ALERT_PHONE  (where Hoser texts you; defaults to the number you gave)
// Without those, sendSMS() no-ops and just logs what it WOULD have sent, so the rest
// of the pipeline still runs — nothing crashes, you just won't get the text until the
// Twilio creds are in place.
//
// Receiving your "go ahead" reply is handled by the /sms/incoming webhook in server.js,
// which Twilio calls when you text the Twilio number back. validateTwilioSignature()
// below proves the request really came from Twilio and not a random internet POST.

const crypto = require('crypto');

const DEFAULT_ALERT_PHONE = process.env.HOSER_ALERT_PHONE || '+14698913956';

function isConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}

// Send an SMS. Returns { sent: bool, ... }. Never throws — a texting failure must not
// take down the daily pipeline.
async function sendSMS(body, to = DEFAULT_ALERT_PHONE) {
  if (!isConfigured()) {
    console.log(`[notify] (Twilio not configured) would text ${to}: ${body}`);
    return { sent: false, reason: 'twilio-not-configured', to, body };
  }
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  try {
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${auth}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: String(body).slice(0, 1500) }).toString(),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return { sent: false, reason: data.message || `HTTP ${resp.status}`, to };
    return { sent: true, sid: data.sid, to };
  } catch (e) {
    console.error('[notify] sendSMS failed:', e.message);
    return { sent: false, reason: e.message, to };
  }
}

// Validate the X-Twilio-Signature header on an incoming webhook. Twilio signs the
// full URL + the sorted POST params with your auth token (HMAC-SHA1, base64).
function validateTwilioSignature(fullUrl, params, signature) {
  const auth = process.env.TWILIO_AUTH_TOKEN;
  if (!auth || !signature) return false;
  const sorted = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], fullUrl);
  const expected = crypto.createHmac('sha1', auth).update(Buffer.from(sorted, 'utf-8')).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch (_) {
    return false;
  }
}

module.exports = { sendSMS, isConfigured, validateTwilioSignature, DEFAULT_ALERT_PHONE };
