'use strict';

const { app } = require('@azure/functions');
const { respond } = require('../lib/contact');

// POST /api/contact — receives the contact form and chat messages.
app.http('contact', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'contact',
  handler: async (request, context) => respond({
    method: request.method,
    origin: request.headers.get('origin'),
    referer: request.headers.get('referer'),
    contentType: request.headers.get('content-type') || '',
    client: (request.headers.get('x-forwarded-for') || request.headers.get('x-azure-clientip') || '').split(',')[0].trim(),
    body: await request.text(),
  }, process.env, undefined, { warn: (...a) => context.warn(...a), error: (...a) => context.error(...a) }),
});
