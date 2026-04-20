/**
 * Unit tests for the Resend webhook handler.
 * We test the HMAC verification logic in isolation by building a Fastify
 * test app with a scoped raw-body parser exactly as production does.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = process.env['RESEND_WEBHOOK_SECRET']!; // whsec_dGVzdHNlY3JldA==

function signWebhook(body: string, msgId: string, msgTs: string): string {
  const signedContent = `${msgId}.${msgTs}.${body}`;
  const keyBytes = Buffer.from(WEBHOOK_SECRET.replace(/^whsec_/, ''), 'base64');
  return 'v1,' + crypto.createHmac('sha256', keyBytes).update(signedContent).digest('base64');
}

function nowTs(): string {
  return String(Math.floor(Date.now() / 1000));
}

// ─── Build a minimal Fastify test app with the webhook route ─────────────────

async function buildWebhookApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const { handleResendWebhook } = await import('../../src/controllers/webhook.controller.js');

  await app.register(async (hook) => {
    hook.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body);
    });
    hook.post('/webhooks/resend', handleResendWebhook);
  });

  await app.ready();
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Webhook controller', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await connectTestDB();
    app = await buildWebhookApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  it('returns 401 when headers are missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/resend',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with wrong signature', async () => {
    const body = JSON.stringify({ type: 'email.delivered' });
    const ts = nowTs();
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/resend',
      headers: {
        'content-type': 'application/json',
        'webhook-id': 'msg_test',
        'webhook-timestamp': ts,
        'webhook-signature': 'v1,invalidsignature==',
      },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with outdated timestamp', async () => {
    const body = JSON.stringify({ type: 'email.delivered' });
    const oldTs = String(Math.floor(Date.now() / 1000) - 400); // 6+ min ago
    const sig = signWebhook(body, 'msg_old', oldTs);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/resend',
      headers: {
        'content-type': 'application/json',
        'webhook-id': 'msg_old',
        'webhook-timestamp': oldTs,
        'webhook-signature': sig,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 for a valid signature with unknown event type', async () => {
    const body = JSON.stringify({ type: 'email.unknown', data: {} });
    const ts = nowTs();
    const msgId = 'msg_valid_1';
    const sig = signWebhook(body, msgId, ts);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/resend',
      headers: {
        'content-type': 'application/json',
        'webhook-id': msgId,
        'webhook-timestamp': ts,
        'webhook-signature': sig,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ received: true });
  });

  it('returns 200 for email.delivered with a recognised event', async () => {
    const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'test-ses-id' } });
    const ts = nowTs();
    const msgId = 'msg_delivered';
    const sig = signWebhook(body, msgId, ts);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/resend',
      headers: {
        'content-type': 'application/json',
        'webhook-id': msgId,
        'webhook-timestamp': ts,
        'webhook-signature': sig,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
  });

  it('handles multiple v1 signatures (picks the valid one)', async () => {
    const body = JSON.stringify({ type: 'email.opened', data: { email_id: 'ses-2' } });
    const ts = nowTs();
    const msgId = 'msg_multi';
    const validSig = signWebhook(body, msgId, ts);
    const combined = `v1,invalidsig== ${validSig}`;
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/resend',
      headers: {
        'content-type': 'application/json',
        'webhook-id': msgId,
        'webhook-timestamp': ts,
        'webhook-signature': combined,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
  });
});
