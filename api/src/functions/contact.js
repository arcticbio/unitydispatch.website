'use strict';

const { app } = require('@azure/functions');
const { handle } = require('../lib/contact');

// POST /api/contact — receives the contact form and chat messages.
app.http('contact', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'contact',
  handler: async (request, context) => {
    try {
      const result = await handle({
        method: request.method,
        origin: request.headers.get('origin'),
        body: await request.text(),
      }, process.env);
      if (result.failed && result.failed.length) context.warn('Some delivery channels failed:', result.failed);
      return { status: 200, jsonBody: { ok: true } };
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) context.error('Contact submission failed:', err.message, err.causes || '');
      return { status, jsonBody: { ok: false, error: status >= 500 && status !== 503 ? 'The message could not be delivered.' : err.message } };
    }
  },
});
