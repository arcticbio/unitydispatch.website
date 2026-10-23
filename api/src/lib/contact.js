'use strict';

// Validation, formatting and delivery for contact-form and chat submissions.
// Kept free of the Functions runtime so it can be unit tested directly.

const MAX_BODY_BYTES = 20 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const WEBHOOK_TIMEOUT_MS = 10000;
const EMAIL_TIMEOUT_MS = 20000;
// Per-client limit (per function instance): enough for any real visitor.
const RATE_LIMIT = { max: 5, windowMs: 10 * 60 * 1000 };

const LIMITS = {
  firstName: 100, lastName: 100, name: 100, email: 200, phone: 40,
  company: 200, message: 4000, page: 200, source: 20, website: 200,
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const clean = (v) => (typeof v === 'string' ? v.replace(/\s+$/g, '').replace(/^\s+/g, '') : '');

// Accepts JSON (sent by the site's script) or a plain form post (browsers without JavaScript).
function parse(raw, contentType = 'application/json') {
  if (Buffer.byteLength(raw || '', 'utf8') > MAX_BODY_BYTES) throw new HttpError(413, 'Request too large.');
  let data;
  if (/application\/x-www-form-urlencoded/i.test(contentType)) {
    data = Object.fromEntries(new URLSearchParams(raw || ''));
    // The no-JS form sends the phone country code separately.
    if (data.phone && data.phoneCountry) data.phone = `${data.phoneCountry} ${data.phone}`;
  } else {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'Request body must be JSON.');
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Request body must be a JSON object.');
  // The honeypot field is always sent (empty) by the real form and chat.
  const honeypotMissing = !Object.prototype.hasOwnProperty.call(data, 'website');
  const out = {};
  for (const [key, max] of Object.entries(LIMITS)) {
    const value = clean(data[key]);
    if (value.length > max) throw new HttpError(400, `${key} is too long.`);
    out[key] = value;
  }
  out.source = out.source === 'chat' ? 'chat' : 'contact-form';
  out.isBot = honeypotMissing || Boolean(out.website);
  return out;
}

const hits = new Map();
function rateLimited(client, now = Date.now()) {
  if (!client) return false;
  const recent = (hits.get(client) || []).filter((t) => now - t < RATE_LIMIT.windowMs);
  recent.push(now);
  hits.set(client, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > RATE_LIMIT.max;
}

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function validate(sub) {
  if (sub.source === 'contact-form' && !sub.firstName) throw new HttpError(400, 'Enter a first name.');
  if (!sub.email) throw new HttpError(400, 'Enter an email address.');
  if (!EMAIL_RE.test(sub.email)) throw new HttpError(400, 'Enter an email address like example@mysite.com.');
  if (!sub.message) throw new HttpError(400, sub.source === 'chat' ? 'Enter a message.' : 'Enter an answer.');
}

function format(sub, now = new Date()) {
  const who = sub.source === 'chat'
    ? (sub.name || sub.email)
    : [sub.firstName, sub.lastName].filter(Boolean).join(' ');
  const subject = sub.source === 'chat' ? `Website chat message from ${who}` : `Website enquiry from ${who}`;
  const rows = sub.source === 'chat'
    ? [['Name', sub.name], ['Email', sub.email], ['Message', sub.message]]
    : [['First name', sub.firstName], ['Last name', sub.lastName], ['Email', sub.email], ['Phone', sub.phone],
      ['Company name', sub.company], ['How can we help you?', sub.message]];
  const text = [
    ...rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
    '',
    `Submitted ${now.toISOString()} from ${sub.page || '/'} (${sub.source}).`,
  ].join('\n');
  return { subject, text, replyTo: sub.email, submission: { ...sub, website: undefined, isBot: undefined, submittedAt: now.toISOString() } };
}

function allowedOrigin(origin, env) {
  const list = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return !list.length || (origin && list.includes(origin));
}

async function deliver(msg, env, deps = {}) {
  const doFetch = deps.fetch || fetch;
  const timeouts = { webhook: WEBHOOK_TIMEOUT_MS, email: EMAIL_TIMEOUT_MS, ...deps.timeouts };
  const channels = [];

  if (env.CONTACT_WEBHOOK_URL) {
    channels.push((async () => {
      const res = await doFetch(env.CONTACT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject: msg.subject, text: msg.text, replyTo: msg.replyTo, ...msg.submission }),
        signal: AbortSignal.timeout(timeouts.webhook),
      });
      if (!res.ok) throw new Error(`webhook responded ${res.status}`);
    })());
  }

  if (env.ACS_CONNECTION_STRING && env.CONTACT_TO_EMAIL && env.CONTACT_FROM_EMAIL) {
    channels.push(withTimeout((async () => {
      const EmailClient = deps.EmailClient || require('@azure/communication-email').EmailClient;
      const client = new EmailClient(env.ACS_CONNECTION_STRING);
      const poller = await client.beginSend({
        senderAddress: env.CONTACT_FROM_EMAIL,
        content: { subject: msg.subject, plainText: msg.text },
        recipients: { to: env.CONTACT_TO_EMAIL.split(',').map((address) => ({ address: address.trim() })) },
        replyTo: [{ address: msg.replyTo }],
      });
      const result = await poller.pollUntilDone();
      if (result.status !== 'Succeeded') throw new Error(`email status ${result.status}`);
    })(), timeouts.email, 'email'));
  }

  if (!channels.length) throw new HttpError(503, 'The contact form is not configured yet.');
  // Succeed if at least one configured channel delivered the message.
  const results = await Promise.allSettled(channels);
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length === results.length) {
    const err = new HttpError(502, 'The message could not be delivered.');
    err.causes = failed.map((f) => String(f.reason && f.reason.message || f.reason));
    throw err;
  }
  return { delivered: results.length - failed.length, failed: failed.map((f) => String(f.reason && f.reason.message || f.reason)) };
}

async function handle({ method, origin, body, contentType, client }, env, deps) {
  if (method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  if (!allowedOrigin(origin, env)) throw new HttpError(403, 'Origin not allowed.');
  const sub = parse(body, contentType);
  // Honeypot: bots fill in or omit the hidden "website" field. Pretend success.
  if (sub.isBot) return { ok: true, skipped: true };
  if (rateLimited(client)) throw new HttpError(429, 'Too many messages. Please try again later.');
  validate(sub);
  const result = await deliver(format(sub), env, deps);
  return { ok: true, ...result };
}

// Where to send a browser that posted the plain HTML form (no JavaScript):
// back to the page it came from, at a notice the page shows via :target.
function backTo(referer, host, notice) {
  let path = '/';
  try {
    const url = new URL(referer || '');
    if (url.host === host) path = url.pathname;
  } catch { /* no or invalid referer */ }
  return `${path}#${notice}`;
}

// Runs a submission and shapes the HTTP response: JSON for the site's script,
// a 303 redirect back to the page for plain form posts.
async function respond(req, env, deps, log = {}) {
  const isFormPost = /application\/x-www-form-urlencoded/i.test(req.contentType || '');
  try {
    const result = await handle(req, env, deps);
    if (result.failed && result.failed.length && log.warn) log.warn('Some delivery channels failed:', result.failed);
    if (isFormPost) return { status: 303, headers: { location: backTo(req.referer, req.host, 'contact-sent') } };
    return { status: 200, jsonBody: { ok: true } };
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500 && log.error) log.error('Contact submission failed:', err.message, err.causes || '');
    if (isFormPost) return { status: 303, headers: { location: backTo(req.referer, req.host, 'contact-failed') } };
    return { status, jsonBody: { ok: false, error: status >= 500 && status !== 503 ? 'The message could not be delivered.' : err.message } };
  }
}

module.exports = { respond, handle, parse, validate, format, deliver, HttpError, _resetRateLimit: () => hits.clear() };
