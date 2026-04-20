import { Partner } from '../models/Partner.js';
import { Activity } from '../models/Activity.js';
import type { CreatePartnerInput, UpdatePartnerInput, ListPartnersInput } from '../schemas/partner.schema.js';
import { ActivityType } from '../types/enums.js';

export async function listPartners(query: ListPartnersInput) {
  const { stage, search, page, limit } = query;
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (stage) filter['stage'] = stage;
  if (search) {
    const re = new RegExp(search, 'i');
    filter['$or'] = [{ firstName: re }, { lastName: re }, { email: re }, { company: re }];
  }

  const [items, total] = await Promise.all([
    Partner.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    Partner.countDocuments(filter),
  ]);

  const ids = items.map((p) => p._id);
  const [emailCounts, activityCounts] = await Promise.all([
    import('../models/EmailLog.js').then(({ EmailLog }) =>
      EmailLog.aggregate([
        { $match: { partnerId: { $in: ids } } },
        { $group: { _id: '$partnerId', count: { $sum: 1 } } },
      ]),
    ),
    Activity.aggregate([
      { $match: { partnerId: { $in: ids } } },
      { $group: { _id: '$partnerId', count: { $sum: 1 } } },
    ]),
  ]);

  const emailMap = new Map(emailCounts.map((e: { _id: unknown; count: number }) => [String(e._id), e.count]));
  const activityMap = new Map(activityCounts.map((a: { _id: unknown; count: number }) => [String(a._id), a.count]));

  const data = items.map((p) => ({
    ...p,
    id: String(p._id),
    _id: undefined,
    __v: undefined,
    _count: {
      emailLogs: emailMap.get(String(p._id)) ?? 0,
      activities: activityMap.get(String(p._id)) ?? 0,
    },
  }));

  return { data, total, page, limit, pages: Math.ceil(total / limit) };
}

export async function getPartnerById(id: string) {
  const { EmailLog } = await import('../models/EmailLog.js');
  const [partner, emailLogs, activities] = await Promise.all([
    Partner.findById(id).lean(),
    EmailLog.find({ partnerId: id })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('attachments.materialId')
      .lean(),
    Activity.find({ partnerId: id }).sort({ createdAt: -1 }).limit(50).lean(),
  ]);
  if (!partner) return null;
  return { ...partner, id: String(partner._id), _id: undefined, __v: undefined, emailLogs, activities };
}

export async function createPartner(data: CreatePartnerInput) {
  const partner = await Partner.create(data);
  await Activity.create({ partnerId: partner._id, type: ActivityType.CREATED, detail: 'Partner created' });
  return partner;
}

export async function updatePartner(id: string, data: UpdatePartnerInput) {
  const current = await Partner.findById(id);
  if (!current) throw new Error('Not found');
  const partner = await Partner.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (!partner) throw new Error('Not found');
  if (data.stage && data.stage !== current.stage) {
    await Activity.create({
      partnerId: id,
      type: ActivityType.STAGE_CHANGE,
      detail: `Stage changed from ${current.stage} to ${data.stage}`,
    });
  }
  return partner;
}

export async function deletePartner(id: string) {
  const partner = await Partner.findByIdAndDelete(id);
  if (!partner) throw new Error('Not found');
  return partner;
}

export async function importPartners(rows: CreatePartnerInput[]) {
  const results = { created: 0, updated: 0, errors: [] as { row: number; error: string }[] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    try {
      const existing = await Partner.findOne({ email: row.email.toLowerCase() });
      if (existing) {
        await Partner.findOneAndUpdate({ email: row.email.toLowerCase() }, row, { runValidators: true });
        results.updated++;
      } else {
        const partner = await Partner.create(row);
        await Activity.create({ partnerId: partner._id, type: ActivityType.IMPORTED, detail: 'Imported from CSV' });
        results.created++;
      }
    } catch (err) {
      results.errors.push({ row: i + 1, error: String(err) });
    }
  }
  return results;
}
