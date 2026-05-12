import { Investor } from '../models/Investor.js';
import { Enrollment } from '../models/Enrollment.js';
import { Activity } from '../models/Activity.js';
import type { CreateInvestorInput, UpdateInvestorInput, ListInvestorsInput } from '../schemas/investor.schema.js';
import { ActivityType, InvestorStage } from '../types/enums.js';

export async function listInvestors(query: ListInvestorsInput) {
  const { stage, search, page, limit, notEnrolledInAnySequence } = query;
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (stage) filter['stage'] = stage;
  if (search) {
    const re = new RegExp(search, 'i');
    filter['$or'] = [{ firstName: re }, { lastName: re }, { email: re }, { company: re }];
  }
  if (notEnrolledInAnySequence) {
    const enrolledIds = await Enrollment.distinct('entityId', { entityType: 'INVESTOR', status: { $ne: 'UNSUBSCRIBED' } });
    filter['_id'] = { $nin: enrolledIds };
  }

  const [items, total] = await Promise.all([
    Investor.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    Investor.countDocuments(filter),
  ]);

  const ids = items.map((i) => i._id);
  const [emailCounts, activityCounts] = await Promise.all([
    import('../models/EmailLog.js').then(({ EmailLog }) =>
      EmailLog.aggregate([
        { $match: { investorId: { $in: ids } } },
        { $group: { _id: '$investorId', count: { $sum: 1 } } },
      ]),
    ),
    Activity.aggregate([
      { $match: { investorId: { $in: ids } } },
      { $group: { _id: '$investorId', count: { $sum: 1 } } },
    ]),
  ]);

  const emailMap = new Map(emailCounts.map((e: { _id: unknown; count: number }) => [String(e._id), e.count]));
  const activityMap = new Map(activityCounts.map((a: { _id: unknown; count: number }) => [String(a._id), a.count]));

  const data = items.map((i) => ({
    ...i,
    id: String(i._id),
    _id: undefined,
    __v: undefined,
    _count: {
      emailLogs: emailMap.get(String(i._id)) ?? 0,
      activities: activityMap.get(String(i._id)) ?? 0,
    },
  }));

  return { data, total, page, limit, pages: Math.ceil(total / limit) };
}

export async function getInvestorById(id: string) {
  const { EmailLog } = await import('../models/EmailLog.js');
  const [investor, emailLogs, activities] = await Promise.all([
    Investor.findById(id).lean(),
    EmailLog.find({ investorId: id })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('attachments.materialId')
      .lean(),
    Activity.find({ investorId: id }).sort({ createdAt: -1 }).limit(50).lean(),
  ]);
  if (!investor) return null;
  return { ...investor, id: String(investor._id), _id: undefined, __v: undefined, emailLogs, activities };
}

export async function createInvestor(data: CreateInvestorInput) {
  const investor = await Investor.create(data);
  await Activity.create({ investorId: investor._id, type: ActivityType.CREATED, detail: 'Investor created' });
  return investor;
}

export async function updateInvestor(id: string, data: UpdateInvestorInput) {
  const current = await Investor.findById(id);
  if (!current) throw new Error('Not found');
  const investor = await Investor.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (!investor) throw new Error('Not found');
  if (data.stage && data.stage !== current.stage) {
    await Activity.create({
      investorId: id,
      type: ActivityType.STAGE_CHANGE,
      detail: `Stage changed from ${current.stage} to ${data.stage}`,
    });
    if (data.stage !== InvestorStage.PROSPECT) {
      await Enrollment.updateMany(
        { entityId: id, entityType: 'INVESTOR', status: 'ACTIVE' },
        { status: 'UNSUBSCRIBED' },
      );
    }
  }
  return investor;
}

export async function deleteInvestor(id: string) {
  const investor = await Investor.findByIdAndDelete(id);
  if (!investor) throw new Error('Not found');
  return investor;
}

export async function importInvestors(rows: CreateInvestorInput[]) {
  const results = { created: 0, updated: 0, errors: [] as { row: number; error: string }[] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    try {
      const existing = await Investor.findOne({ email: row.email.toLowerCase() });
      if (existing) {
        await Investor.findOneAndUpdate({ email: row.email.toLowerCase() }, row, { runValidators: true });
        results.updated++;
      } else {
        const investor = await Investor.create(row);
        await Activity.create({ investorId: investor._id, type: ActivityType.IMPORTED, detail: 'Imported from CSV' });
        results.created++;
      }
    } catch (err) {
      results.errors.push({ row: i + 1, error: String(err) });
    }
  }
  return results;
}
