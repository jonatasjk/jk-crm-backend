import { resend } from '../config/aws.js';
import { env } from '../config/env.js';
import { getMaterialBuffer } from './material.service.js';
import { EmailStatus, EntityType, ActivityType } from '../types/enums.js';
import { EmailLog } from '../models/EmailLog.js';
import { Activity } from '../models/Activity.js';
import { Investor } from '../models/Investor.js';
import { Partner } from '../models/Partner.js';
import { Material } from '../models/Material.js';
import type { SendEmailInput } from '../schemas/email.schema.js';

export async function sendEmail(input: SendEmailInput) {
  // Daily cap: max DAILY_EMAIL_LIMIT emails per calendar day across sequences and individual sends
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const sentToday = await EmailLog.countDocuments({
    status: EmailStatus.SENT,
    sentAt: { $gte: startOfDay },
  });
  if (sentToday >= env.DAILY_EMAIL_LIMIT) throw new Error(`Daily email limit of ${env.DAILY_EMAIL_LIMIT} reached`);

  // Resolve recipient
  let toEmail: string;
  let toName: string;

  if (input.entityType === EntityType.INVESTOR) {
    const investor = await Investor.findById(input.entityId);
    if (!investor) throw new Error('Not found');
    toEmail = investor.email;
    toName = `${investor.firstName} ${investor.lastName}`.trim();
  } else {
    const partner = await Partner.findById(input.entityId);
    if (!partner) throw new Error('Not found');
    toEmail = partner.email;
    toName = `${partner.firstName} ${partner.lastName}`.trim();
  }

  // Interpolate placeholders
  const firstName = toName.split(' ')[0] ?? toName;
  const lastName  = toName.split(' ').slice(1).join(' ');
  const interpolate = (s: string) =>
    s
      .replace(/\{\{first_name\}\}/g, firstName)
      .replace(/\{\{last_name\}\}/g,  lastName)
      .replace(/\{\{name\}\}/g,       toName);
  const subject = interpolate(input.subject);
  const body    = interpolate(input.body);

  // Fetch material buffers from local directory
  const attachments: { name: string; buffer: Buffer; mimeType: string }[] = [];
  const attachmentDocs: { materialId: string; materialName: string }[] = [];
  for (const materialId of input.materialIds) {
    const material = await Material.findById(materialId);
    if (!material) throw new Error(`Material not found: ${materialId}`);
    const { buffer, mimeType } = await getMaterialBuffer(material.fileKey);
    attachments.push({ name: material.name, buffer, mimeType });
    attachmentDocs.push({ materialId: material.id as string, materialName: material.name });
  }

  // Create email log (pending)
  const emailLog = await EmailLog.create({
    subject,
    body,
    status: EmailStatus.PENDING,
    ...(input.entityType === EntityType.INVESTOR ? { investorId: input.entityId } : { partnerId: input.entityId }),
    attachments: attachmentDocs,
  });

  try {
    const { data, error } = await resend.emails.send({
      from: `${env.FROM_NAME} <${env.FROM_EMAIL}>`,
      to: toEmail,
      subject,
      html: body,
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

    // Record activity
    await Activity.create({
      type: ActivityType.EMAIL_SENT,
      detail: `Email sent: "${subject}"`,
      ...(input.entityType === EntityType.INVESTOR
        ? { investorId: input.entityId }
        : { partnerId: input.entityId }),
    });

    return { success: true, messageId: data?.id, emailLogId: emailLog._id };
  } catch (err) {
    await EmailLog.findByIdAndUpdate(emailLog._id, { status: EmailStatus.FAILED });
    throw err;
  }
}

export async function getEmailLogs(entityId: string, entityType: EntityType) {
  const filter = entityType === EntityType.INVESTOR ? { investorId: entityId } : { partnerId: entityId };
  return EmailLog.find(filter).sort({ createdAt: -1 }).limit(100).lean();
}

export async function listAllEmailLogs(limit = 200) {
  const logs = await EmailLog.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const investorIds = [...new Set(logs.filter((l) => l.investorId).map((l) => String(l.investorId)))];
  const partnerIds  = [...new Set(logs.filter((l) => l.partnerId).map((l) => String(l.partnerId)))];

  const { Investor } = await import('../models/Investor.js');
  const { Partner }  = await import('../models/Partner.js');

  const [investors, partners] = await Promise.all([
    investorIds.length ? Investor.find({ _id: { $in: investorIds } }).select('firstName lastName email').lean() : [],
    partnerIds.length  ? Partner.find({ _id: { $in: partnerIds } }).select('firstName lastName email').lean() : [],
  ]);

  const invMap = new Map(investors.map((i) => [String(i._id), i]));
  const parMap = new Map(partners.map((p) => [String(p._id), p]));

  return logs.map((l) => {
    const entityType = l.investorId ? 'INVESTOR' : 'PARTNER';
    const entityId   = l.investorId ? String(l.investorId) : String(l.partnerId);
    const entity     = l.investorId ? invMap.get(entityId) : parMap.get(entityId);
    return {
      ...l,
      id: String(l._id),
      _id: undefined,
      __v: undefined,
      entityType,
      entityId,
      recipientName:  entity ? `${(entity as unknown as { firstName: string; lastName: string }).firstName ?? ''} ${(entity as unknown as { firstName: string; lastName: string }).lastName ?? ''}`.trim() || '—' : '—',
      recipientEmail: entity?.email ?? '—',
    };
  });
}

export async function getEmailStats() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const sentToday = await EmailLog.countDocuments({
    status: EmailStatus.SENT,
    sentAt: { $gte: start, $lte: end },
  });

  return { sentToday };
}
