/**
 * Resend webhook handler.
 *
 * Resend uses Svix for delivery. Verification:
 *   signed_content = "${webhook-id}.${webhook-timestamp}.${rawBody}"
 *   key            = base64-decode(secret.replace("whsec_",""))
 *   signature      = HMAC-SHA256(key, signed_content) → base64
 *
 * The request body must be consumed as a raw Buffer (registered via a scoped
 * content-type parser in app.ts).
 */
import crypto from 'crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { EmailLog } from '../models/EmailLog.js';
import { EmailStatus } from '../types/enums.js';
import { env } from '../config/env.js';

const TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

type ReqLog = { warn(obj: object | string, msg?: string): void };

function verify(
  rawBody: Buffer,
  headers: Record<string, string | undefined>,
  secret: string,
  log?: ReqLog,
): boolean {
  const msgId  = headers['webhook-id'];
  const msgTs  = headers['webhook-timestamp'];
  const sigHdr = headers['webhook-signature'];

  if (!msgId || !msgTs || !sigHdr) {
    log?.warn({ msgId: !!msgId, msgTs: !!msgTs, sigHdr: !!sigHdr }, 'Resend webhook: missing required headers');
    return false;
  }

  // Replay-attack guard
  const tsMs = Number(msgTs) * 1000;
  if (isNaN(tsMs) || Math.abs(Date.now() - tsMs) > TOLERANCE_MS) {
    log?.warn({ msgTs, ageMs: Date.now() - tsMs }, 'Resend webhook: timestamp outside tolerance');
    return false;
  }

  const signedContent = `${msgId}.${msgTs}.${rawBody.toString('utf-8')}`;
  const keyBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const computed = crypto.createHmac('sha256', keyBytes).update(signedContent).digest('base64');
  const computedBuf = Buffer.from(computed);

  // sigHdr may contain multiple "v1,<b64>" entries separated by spaces
  const ok = sigHdr.split(' ').some((part) => {
    const b64 = part.split(',')[1];
    if (!b64) return false;
    const b64Buf = Buffer.from(b64);
    // timingSafeEqual requires identical byte lengths
    if (b64Buf.length !== computedBuf.length) return false;
    return crypto.timingSafeEqual(b64Buf, computedBuf);
  });

  if (!ok) log?.warn('Resend webhook: signature mismatch');
  return ok;
}

const STATUS_MAP: Partial<Record<string, EmailStatus>> = {
  'email.delivered':        EmailStatus.DELIVERED,
  'email.bounced':          EmailStatus.BOUNCED,
  'email.complained':       EmailStatus.COMPLAINED,
  'email.opened':           EmailStatus.OPENED,
  'email.clicked':          EmailStatus.CLICKED,
  'email.delivery_delayed': EmailStatus.DELIVERY_DELAYED,
};

export async function handleResendWebhook(req: FastifyRequest, reply: FastifyReply) {
  const rawBody = req.body as Buffer;

  if (!Buffer.isBuffer(rawBody)) {
    req.log.error({ bodyType: typeof rawBody }, 'Resend webhook: body is not a Buffer — check content-type parser scope');
    return reply.code(400).send({ error: 'Raw body expected' });
  }

  if (!verify(rawBody, req.headers as Record<string, string | undefined>, env.RESEND_WEBHOOK_SECRET, req.log)) {
    return reply.code(401).send({ error: 'Invalid signature' });
  }

  let event: { type: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(rawBody.toString('utf-8')) as typeof event;
  } catch {
    return reply.code(400).send({ error: 'Invalid JSON' });
  }

  const newStatus = STATUS_MAP[event.type];
  if (newStatus && event.data?.email_id) {
    await EmailLog.findOneAndUpdate(
      { sesMessageId: event.data.email_id },
      { status: newStatus },
    );
  }

  return reply.code(200).send({ received: true });
}
