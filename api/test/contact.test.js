'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handle } = require('../src/lib/contact');

const form = (over = {}) => JSON.stringify({
  source: 'contact-form', page: '/', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com',
  phone: '+1 262 555 0100', company: 'Analytical Engines', message: 'Please send a demo.', website: '', ...over,
});
const post = (body, origin = 'https://www.unitydispatch.net') => ({ method: 'POST', origin, body });

function fakeFetch(status = 200) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return { ok: status < 400, status }; };
  fn.calls = calls;
  return fn;
}

function fakeEmailClient(status = 'Succeeded') {
  const sent = [];
  class EmailClient {
    constructor(conn) { this.conn = conn; }
    async beginSend(message) { sent.push(message); return { pollUntilDone: async () => ({ status }) }; }
  }
  EmailClient.sent = sent;
  return EmailClient;
}

const rejects = (promise, status, message) => assert.rejects(promise, (err) => {
  assert.equal(err.status, status);
  if (message) assert.match(err.message, message);
  return true;
});

test('requires POST', () => rejects(handle({ method: 'GET', body: '' }, {}), 405));

test('rejects malformed JSON and oversize bodies', async () => {
  await rejects(handle(post('{nope'), {}), 400, /JSON/);
  await rejects(handle(post(form({ message: 'x'.repeat(30000) })), {}), 413);
});

test('validates like the form does', async () => {
  const env = { CONTACT_WEBHOOK_URL: 'https://hook.example/x' };
  await rejects(handle(post(form({ firstName: '' })), env), 400, /first name/);
  await rejects(handle(post(form({ email: '' })), env), 400, /email address\./);
  await rejects(handle(post(form({ email: 'ada@' })), env), 400, /like example@mysite\.com/);
  await rejects(handle(post(form({ message: '  ' })), env), 400, /answer/);
  await rejects(handle(post(form({ company: 'x'.repeat(201) })), env), 400, /company is too long/);
});

test('silently accepts honeypot submissions without delivering', async () => {
  const f = fakeFetch();
  const res = await handle(post(form({ website: 'http://spam' })), { CONTACT_WEBHOOK_URL: 'https://hook.example/x' }, { fetch: f });
  assert.deepEqual(res, { ok: true, skipped: true });
  assert.equal(f.calls.length, 0);
});

test('reports 503 when no delivery channel is configured', () => rejects(handle(post(form()), {}), 503));

test('posts submissions to the webhook', async () => {
  const f = fakeFetch();
  const res = await handle(post(form()), { CONTACT_WEBHOOK_URL: 'https://hook.example/x' }, { fetch: f });
  assert.equal(res.ok, true);
  assert.equal(f.calls.length, 1);
  const body = JSON.parse(f.calls[0].init.body);
  assert.equal(body.subject, 'Website enquiry from Ada Lovelace');
  assert.equal(body.replyTo, 'ada@example.com');
  assert.match(body.text, /How can we help you\?: Please send a demo\./);
  assert.equal(body.website, undefined);
});

test('sends email through Azure Communication Services', async () => {
  const EmailClient = fakeEmailClient();
  const env = { ACS_CONNECTION_STRING: 'endpoint=https://x;accesskey=y', CONTACT_TO_EMAIL: 'info@unitydispatch.net', CONTACT_FROM_EMAIL: 'DoNotReply@example.azurecomm.net' };
  await handle(post(JSON.stringify({ source: 'chat', name: 'Ada', email: 'ada@example.com', message: 'Hi!' })), env, { EmailClient });
  assert.equal(EmailClient.sent.length, 1);
  const m = EmailClient.sent[0];
  assert.equal(m.senderAddress, 'DoNotReply@example.azurecomm.net');
  assert.deepEqual(m.recipients.to, [{ address: 'info@unitydispatch.net' }]);
  assert.deepEqual(m.replyTo, [{ address: 'ada@example.com' }]);
  assert.equal(m.content.subject, 'Website chat message from Ada');
});

test('succeeds when one of two channels fails, fails when all do', async () => {
  const env = { CONTACT_WEBHOOK_URL: 'https://hook.example/x', ACS_CONNECTION_STRING: 'c', CONTACT_TO_EMAIL: 'a@b.co', CONTACT_FROM_EMAIL: 'c@d.co' };
  const partial = await handle(post(form()), env, { fetch: fakeFetch(500), EmailClient: fakeEmailClient() });
  assert.equal(partial.delivered, 1);
  await rejects(handle(post(form()), env, { fetch: fakeFetch(500), EmailClient: fakeEmailClient('Failed') }), 502);
});

test('enforces ALLOWED_ORIGINS when set', async () => {
  const env = { CONTACT_WEBHOOK_URL: 'https://hook.example/x', ALLOWED_ORIGINS: 'https://www.unitydispatch.net, https://unitydispatch.net' };
  await rejects(handle(post(form(), 'https://evil.example'), env, { fetch: fakeFetch() }), 403);
  const ok = await handle(post(form(), 'https://unitydispatch.net'), env, { fetch: fakeFetch() });
  assert.equal(ok.ok, true);
});
