import { Customer } from '../models/Customer.js';
import { Enrollment } from '../models/Enrollment.js';
import { Activity } from '../models/Activity.js';
import type { CreateCustomerInput, UpdateCustomerInput, ListCustomersInput } from '../schemas/customer.schema.js';
import { ActivityType, CustomerStage } from '../types/enums.js';

export async function listCustomers(query: ListCustomersInput) {
  const { stage, search, page, limit, notEnrolledInAnySequence } = query;
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (stage) filter['stage'] = stage;
  if (search) {
    const re = new RegExp(search, 'i');
    filter['$or'] = [{ firstName: re }, { lastName: re }, { email: re }, { company: re }];
  }
  if (notEnrolledInAnySequence) {
    const enrolledIds = await Enrollment.distinct('entityId', { entityType: 'CUSTOMER', status: { $ne: 'UNSUBSCRIBED' } });
    filter['_id'] = { $nin: enrolledIds };
  }

  const [items, total] = await Promise.all([
    Customer.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    Customer.countDocuments(filter),
  ]);

  const ids = items.map((c) => c._id);
  const [emailCounts, activityCounts] = await Promise.all([
    import('../models/EmailLog.js').then(({ EmailLog }) =>
      EmailLog.aggregate([
        { $match: { customerId: { $in: ids } } },
        { $group: { _id: '$customerId', count: { $sum: 1 } } },
      ]),
    ),
    Activity.aggregate([
      { $match: { customerId: { $in: ids } } },
      { $group: { _id: '$customerId', count: { $sum: 1 } } },
    ]),
  ]);

  const emailMap = new Map(emailCounts.map((e: { _id: unknown; count: number }) => [String(e._id), e.count]));
  const activityMap = new Map(activityCounts.map((a: { _id: unknown; count: number }) => [String(a._id), a.count]));

  const data = items.map((c) => ({
    ...c,
    id: String(c._id),
    _id: undefined,
    __v: undefined,
    _count: {
      emailLogs: emailMap.get(String(c._id)) ?? 0,
      activities: activityMap.get(String(c._id)) ?? 0,
    },
  }));

  return { data, total, page, limit, pages: Math.ceil(total / limit) };
}

export async function getCustomerById(id: string) {
  const { EmailLog } = await import('../models/EmailLog.js');
  const [customer, emailLogs, activities] = await Promise.all([
    Customer.findById(id).lean(),
    EmailLog.find({ customerId: id })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('attachments.materialId')
      .lean(),
    Activity.find({ customerId: id }).sort({ createdAt: -1 }).limit(50).lean(),
  ]);
  if (!customer) return null;
  return { ...customer, id: String(customer._id), _id: undefined, __v: undefined, emailLogs, activities };
}

export async function createCustomer(data: CreateCustomerInput) {
  const customer = await Customer.create(data);
  await Activity.create({ customerId: customer._id, type: ActivityType.CREATED, detail: 'Customer created' });
  return customer;
}

export async function updateCustomer(id: string, data: UpdateCustomerInput) {
  const current = await Customer.findById(id);
  if (!current) throw new Error('Not found');
  const customer = await Customer.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (!customer) throw new Error('Not found');
  if (data.stage && data.stage !== current.stage) {
    await Activity.create({
      customerId: id,
      type: ActivityType.STAGE_CHANGE,
      detail: `Stage changed from ${current.stage} to ${data.stage}`,
    });
    if (data.stage !== CustomerStage.LEAD) {
      await Enrollment.updateMany(
        { entityId: id, entityType: 'CUSTOMER', status: 'ACTIVE' },
        { status: 'UNSUBSCRIBED' },
      );
    }
  }
  return customer;
}

export async function deleteCustomer(id: string) {
  const customer = await Customer.findByIdAndDelete(id);
  if (!customer) throw new Error('Not found');
  return customer;
}

export async function importCustomers(rows: CreateCustomerInput[]) {
  const results = { created: 0, updated: 0, errors: [] as { row: number; error: string }[] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    try {
      const existing = await Customer.findOne({ email: row.email.toLowerCase() });
      if (existing) {
        await Customer.findOneAndUpdate({ email: row.email.toLowerCase() }, row, { runValidators: true });
        results.updated++;
      } else {
        const customer = await Customer.create(row);
        await Activity.create({ customerId: customer._id, type: ActivityType.IMPORTED, detail: 'Imported from CSV' });
        results.created++;
      }
    } catch (err) {
      results.errors.push({ row: i + 1, error: String(err) });
    }
  }
  return results;
}
