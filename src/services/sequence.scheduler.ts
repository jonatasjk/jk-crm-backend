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
import { getMaterialBuffer } from './material.service.js';
import { resend } from '../config/aws.js';
import { env } from '../config/env.js';
import { EmailStatus, ActivityType } from '../types/enums.js';

export async function processEnrollment(enrollmentId: string): Promise<void> {
  const enrollment = await Enrollment.findById(enrollmentId);
  if (!enrollment || enrollment.status !== 'ACTIVE') return;

  const sequence = await Sequence.findById(enrollment.sequenceId);
  if (!sequence || sequence.status !== 'ACTIVE') return;

  const sortedSteps = [...sequence.steps].sort((a, b) => a.order - b.order);
  const step = sortedSteps[enrollment.currentStepIndex];
  if (!step) return;

  // Guard: this step was already sent (e.g. crash after send, before index advance)
  // Recover by advancing the index without re-sending.
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
      const { buffer, mimeType } = await getMaterialBuffer(material.fileKey);
      attachments.push({ name: material.name, buffer, mimeType });
      attachmentDocs.push({ materialId: String(material._id), materialName: material.name });
    }
  }

  // Create email log (PENDING)
  const emailLog = await EmailLog.create({
    subject,
    body: bodyHtml,
    status: EmailStatus.PENDING,
    ...(enrollment.entityType === 'INVESTOR'
      ? { investorId: enrollment.entityId }
      : { partnerId: enrollment.entityId }),
    attachments: attachmentDocs,
  });

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
  } catch {
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
  // Daily cap: max 100 emails per calendar day (sequences + individual sends)
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const sentToday = await EmailLog.countDocuments({
    status: EmailStatus.SENT,
    sentAt: { $gte: startOfDay },
  });
  if (sentToday >= 100) return;

  // Process 1 enrollment per tick (rate: 1/minute)
  const due = await Enrollment.findOne({
    status: 'ACTIVE',
    nextSendAt: { $lte: new Date() },
  })
    .select('_id')
    .lean();

  if (!due) return;

  await processEnrollment(String(due._id));
}

const INTERVAL_MS = 60 * 1000; // 1 minute — max 1 email/min, 100/day

export function startSequenceScheduler(): void {
  // Run once immediately, then every 5 minutes
  setTimeout(() => {
    void runSchedulerTick();
    setInterval(() => { void runSchedulerTick(); }, INTERVAL_MS);
  }, 10_000); // slight delay to let server fully start
}
