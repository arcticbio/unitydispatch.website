'use strict';

// Validation, formatting and delivery for contact-form and chat submissions.
// Kept free of the Functions runtime so it can be unit tested directly.

const MAX_BODY_BYTES = 20 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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

function parse(raw) {
  if (Buffer.byteLength(raw || '', 'utf8') > MAX_BODY_BYTES) throw new HttpError(413, 'Request too large.');
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Request body must be JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Request body must be a JSON object.');
  const out = {};
  for (const [key, max] of Object.entries(LIMITS)) {
    const value = clean(data[key]);
    if (value.length > max) throw new HttpError(400, `${key} is too long.`);
    out[key] = value;
  }
  out.source = out.source === 'chat' ? 'chat' : 'contact-form';
  return out;
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
  return { subject, text, replyTo: sub.email, submission: { ...sub, website: undefined, submittedAt: now.toISOString() } };
}

function allowedOrigin(origin, env) {
  const list = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return !list.length || (origin && list.includes(origin));
}

async function deliver(msg, env, deps = {}) {
  const doFetch = deps.fetch || fetch;
  const channels = [];

  if (env.CONTACT_WEBHOOK_URL) {
    channels.push((async () => {
      const res = await doFetch(env.CONTACT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject: msg.subject, text: msg.text, replyTo: msg.replyTo, ...msg.submission }),
      });
      if (!res.ok) throw new Error(`webhook responded ${res.status}`);
    })());
  }

  if (env.ACS_CONNECTION_STRING && env.CONTACT_TO_EMAIL && env.CONTACT_FROM_EMAIL) {
    channels.push((async () => {
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
    })());
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

async function handle({ method, origin, body }, env, deps) {
  if (method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  if (!allowedOrigin(origin, env)) throw new HttpError(403, 'Origin not allowed.');
  const sub = parse(body);
  // Honeypot: real visitors never fill the hidden "website" field.
  if (sub.website) return { ok: true, skipped: true };
  validate(sub);
  const result = await deliver(format(sub), env, deps);
  return { ok: true, ...result };
}

module.exports = { handle, parse, validate, format, deliver, HttpError };
