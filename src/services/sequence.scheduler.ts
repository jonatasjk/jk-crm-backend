/**
 * Sequence scheduler — runs every 5 minutes, finds enrollments due to send,
 * fires the next email step, then advances or completes the enrollment.
 */
import { Enrollment } from '../models/Enrollment.js';
import { Sequence } from '../models/Sequence.js';
import { EmailLog } from '../models/EmailLog.js';
import { Activity } from '../models/Activity.js';
import { Material } from '../models/Material.js';
import { Investor } from '../models/Investor.js';
import { Partner } from '../models/Partner.js';
import { Customer } from '../models/Customer.js';
import { getMaterialBuffer } from './material.service.js';
import { resend } from '../config/aws.js';
import { env } from '../config/env.js';
import { EmailStatus, ActivityType } from '../types/enums.js';

export async function processEnrollment(enrollmentId: string): Promise<void> {
  // Atomically claim the enrollment so concurrent scheduler ticks cannot double-send.
  // Only succeeds if the enrollment is still ACTIVE and nextSendAt is in the past.
  // Sets nextSendAt 1 hour ahead as a processing lock; the real value is written at the end.
  const enrollment = await Enrollment.findOneAndUpdate(
    { _id: enrollmentId, status: 'ACTIVE', nextSendAt: { $lte: new Date() } },
    { $set: { nextSendAt: new Date(Date.now() + 60 * 60 * 1000) } },
    { new: false },
  );
  if (!enrollment) return; // already claimed by another tick, or no longer active/due

  const sequence = await Sequence.findById(enrollment.sequenceId);
  if (!sequence || sequence.status !== 'ACTIVE') return;

  const sortedSteps = [...sequence.steps].sort((a, b) => a.order - b.order);
  const step = sortedSteps[enrollment.currentStepIndex];
  if (!step) return;

  // Guard: check the EmailLog collection — if this step was already SENT, never send again.
  // This is the primary idempotency check (survives crashes, concurrent ticks, etc.).
  const sentLog = await EmailLog.findOne({
    enrollmentId: enrollment._id,
    stepIndex: enrollment.currentStepIndex,
    status: EmailStatus.SENT,
  }).lean();
  if (sentLog) {
    // Email was delivered but enrollment save may have crashed — recover by advancing.
    const nextStepIndex = enrollment.currentStepIndex + 1;
    const nextStep = sortedSteps[nextStepIndex];
    if (!nextStep) {
      enrollment.status = 'COMPLETED';
      enrollment.completedAt = new Date();
    } else {
      enrollment.currentStepIndex = nextStepIndex;
      const nextSend = new Date();
      nextSend.setDate(nextSend.getDate() + nextStep.delayDays);
      enrollment.nextSendAt = nextSend;
    }
    await enrollment.save();
    return;
  }

  // Secondary guard: stepsLog embedded in enrollment (crash-recovery fallback).
  const alreadySent = enrollment.stepsLog.some((l) => l.stepIndex === enrollment.currentStepIndex);
  if (alreadySent) {
    const nextStepIndex = enrollment.currentStepIndex + 1;
    const nextStep = sortedSteps[nextStepIndex];
    if (!nextStep) {
      enrollment.status = 'COMPLETED';
      enrollment.completedAt = new Date();
    } else {
      enrollment.currentStepIndex = nextStepIndex;
      const nextSend = new Date();
      nextSend.setDate(nextSend.getDate() + nextStep.delayDays);
      enrollment.nextSendAt = nextSend;
    }
    await enrollment.save();
    return;
  }

  // Resolve recipient
  let toEmail = '';
  let toName = '';
  if (enrollment.entityType === 'INVESTOR') {
    const inv = await Investor.findById(enrollment.entityId);
    if (!inv) { await Enrollment.findByIdAndUpdate(enrollmentId, { status: 'UNSUBSCRIBED' }); return; }
    toEmail = inv.email; toName = `${inv.firstName} ${inv.lastName}`.trim();
  } else if (enrollment.entityType === 'CUSTOMER') {
    const cust = await Customer.findById(enrollment.entityId);
    if (!cust) { await Enrollment.findByIdAndUpdate(enrollmentId, { status: 'UNSUBSCRIBED' }); return; }
    toEmail = cust.email; toName = `${cust.firstName} ${cust.lastName}`.trim();
  } else {
    const par = await Partner.findById(enrollment.entityId);
    if (!par) { await Enrollment.findByIdAndUpdate(enrollmentId, { status: 'UNSUBSCRIBED' }); return; }
    toEmail = par.email; toName = `${par.firstName} ${par.lastName}`.trim();
  }
  void toName;

  // Substitute template variables in subject and body
  const firstName = toName.split(' ')[0] ?? toName;
  const lastName  = toName.split(' ').slice(1).join(' ');
  const interpolate = (s: string) =>
    s
      .replace(/\{\{first_name\}\}/g, firstName)
      .replace(/\{\{last_name\}\}/g,  lastName)
      .replace(/\{\{name\}\}/g,       toName);
  const subject  = interpolate(step.subject);
  const bodyHtml = interpolate(step.bodyHtml);
  const attachments: { name: string; buffer: Buffer; mimeType: string }[] = [];
  const attachmentDocs: { materialId: string; materialName: string }[] = [];

  if (step.materialId) {
    const material = await Material.findById(step.materialId);
    if (material) {
      attachmentDocs.push({ materialId: String(material._id), materialName: material.name });
      try {
        const { buffer, mimeType } = await getMaterialBuffer(material.fileKey);
        attachments.push({ name: material.name, buffer, mimeType });
      } catch {
        // Material file missing from disk — do NOT send the email.
        // Record one FILE_MISSING log (skip if one already exists for this step)
        // so the UI surfaces the error, then leave the enrollment untouched so
        // it retries automatically when the file becomes available again.
        const alreadyFlagged = await EmailLog.findOne({
          enrollmentId: enrollment._id,
          stepIndex: enrollment.currentStepIndex,
          status: EmailStatus.FILE_MISSING,
        });
        console.warn(`[scheduler] FILE_MISSING enrollment=${enrollmentId} step=${enrollment.currentStepIndex} material="${material.name}" key=${material.fileKey}`);
        if (!alreadyFlagged) {
          await EmailLog.create({
            subject,
            body: bodyHtml,
            status: EmailStatus.FILE_MISSING,
            errorMessage: `Material file not found: "${material.name}" (key: ${material.fileKey}). The email will be retried automatically once the file is available.`,
            enrollmentId: enrollment._id,
            stepIndex: enrollment.currentStepIndex,
            attachments: attachmentDocs,
            ...(enrollment.entityType === 'INVESTOR'
              ? { investorId: enrollment.entityId }
              : enrollment.entityType === 'CUSTOMER'
                ? { customerId: enrollment.entityId }
                : { partnerId: enrollment.entityId }),
          });
        }
        return;
      }
    }
  }

  // Create email log (PENDING), or reuse one left over from a previous crashed attempt.
  const emailLog =
    (await EmailLog.findOne({
      enrollmentId: enrollment._id,
      stepIndex: enrollment.currentStepIndex,
      status: EmailStatus.PENDING,
    })) ??
    (await EmailLog.create({
      subject,
      body: bodyHtml,
      status: EmailStatus.PENDING,
      ...(enrollment.entityType === 'INVESTOR'
        ? { investorId: enrollment.entityId }
        : enrollment.entityType === 'CUSTOMER'
          ? { customerId: enrollment.entityId }
          : { partnerId: enrollment.entityId }),
      enrollmentId: enrollment._id,
      stepIndex: enrollment.currentStepIndex,
      attachments: attachmentDocs,
    }));

  try {
    const { data, error } = await resend.emails.send({
      from: `${env.FROM_NAME} <${env.FROM_EMAIL}>`,
      to: toEmail,
      subject,
      html: bodyHtml,
      attachments: attachments.map((a) => ({
        filename: a.name,
        content: a.buffer,
      })),
    });
    if (error) throw new Error(error.message);
    await EmailLog.findByIdAndUpdate(emailLog._id, {
      status: EmailStatus.SENT,
      sesMessageId: data?.id,
      sentAt: new Date(),
    });
    console.info(`[scheduler] SENT enrollment=${enrollmentId} step=${enrollment.currentStepIndex} to=${toEmail}`);
  } catch (err) {
    console.error(`[scheduler] FAILED enrollment=${enrollmentId} step=${enrollment.currentStepIndex}`, err);
    await EmailLog.findByIdAndUpdate(emailLog._id, { status: EmailStatus.FAILED });
    // Don't advance on failure — will retry next cycle
    return;
  }

  // Record activity
  await Activity.create({
    type: ActivityType.EMAIL_SENT,
    detail: `Sequence "${sequence.name}" — step ${enrollment.currentStepIndex + 1}: "${step.subject}"`,
    ...(enrollment.entityType === 'INVESTOR'
      ? { investorId: enrollment.entityId }
      : enrollment.entityType === 'CUSTOMER'
        ? { customerId: enrollment.entityId }
        : { partnerId: enrollment.entityId }),
  });

  // Log the step
  enrollment.stepsLog.push({
    stepIndex: enrollment.currentStepIndex,
    sentAt: new Date(),
    emailLogId: emailLog._id as import('mongoose').Types.ObjectId,
  });

  const nextStepIndex = enrollment.currentStepIndex + 1;
  const nextStep = sortedSteps[nextStepIndex];

  if (!nextStep) {
    // Sequence complete
    enrollment.status = 'COMPLETED';
    enrollment.completedAt = new Date();
  } else {
    enrollment.currentStepIndex = nextStepIndex;
    const nextSend = new Date();
    nextSend.setDate(nextSend.getDate() + nextStep.delayDays);
    enrollment.nextSendAt = nextSend;
  }

  await enrollment.save();
}

export async function runSchedulerTick(): Promise<void> {
  // Daily cap: max DAILY_EMAIL_LIMIT emails per calendar day (sequences + individual sends)
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const sentToday = await EmailLog.countDocuments({
    status: EmailStatus.SENT,
    sentAt: { $gte: startOfDay },
  });
  const remaining = env.DAILY_EMAIL_LIMIT - sentToday;
  if (remaining <= 0) {
    console.info(`[scheduler] daily cap of ${env.DAILY_EMAIL_LIMIT} emails reached — skipping tick`);
    return;
  }

  // Process all due enrollments per tick, oldest-due first, up to the remaining daily cap
  const dueEnrollments = await Enrollment.find({
    status: 'ACTIVE',
    nextSendAt: { $lte: new Date() },
  })
    .select('_id')
    .sort({ nextSendAt: 1 })
    .limit(remaining)
    .lean();

  if (dueEnrollments.length === 0) return; // nothing due — silent skip

  console.info(`[scheduler] processing ${dueEnrollments.length} due enrollment(s)`);

  for (const enrollment of dueEnrollments) {
    await processEnrollment(String(enrollment._id));
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

const INTERVAL_MS = 60 * 1000; // check every minute

export function startSequenceScheduler(): void {
  console.info('[scheduler] starting — first tick in 10 s, then every 60 s');
  setTimeout(() => {
    runSchedulerTick().catch(console.error);
    setInterval(() => { runSchedulerTick().catch(console.error); }, INTERVAL_MS);
  }, 10_000);
}
