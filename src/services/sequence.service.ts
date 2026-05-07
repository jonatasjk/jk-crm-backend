import { Sequence } from '../models/Sequence.js';
import { Enrollment } from '../models/Enrollment.js';
import { Investor } from '../models/Investor.js';
import { Partner } from '../models/Partner.js';
import { EntityType } from '../types/enums.js';
import type { ISequenceStep } from '../models/Sequence.js';

// ─── Sequences CRUD ───────────────────────────────────────────────────────────

export async function listSequences() {
  const sequences = await Sequence.find().sort({ createdAt: -1 }).lean();
  const ids = sequences.map((s) => s._id);

  const enrollmentCounts = await Enrollment.aggregate([
    { $match: { sequenceId: { $in: ids } } },
    { $group: { _id: '$sequenceId', total: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ['$status', 'ACTIVE'] }, 1, 0] } } } },
  ]);
  const countMap = new Map(
    enrollmentCounts.map((e: { _id: unknown; total: number; active: number }) => [
      String(e._id),
      { total: e.total, active: e.active },
    ]),
  );

  return sequences.map((s) => ({
    ...s,
    id: String(s._id),
    _id: undefined,
    __v: undefined,
    enrollments: countMap.get(String(s._id)) ?? { total: 0, active: 0 },
  }));
}

export async function getSequenceById(id: string) {
  const sequence = await Sequence.findById(id).lean();
  if (!sequence) return null;
  return { ...sequence, id: String(sequence._id), _id: undefined, __v: undefined };
}

export interface CreateSequenceInput {
  name: string;
  description?: string;
  entityType: (typeof EntityType)[keyof typeof EntityType];
}

export async function createSequence(input: CreateSequenceInput) {
  const seq = await Sequence.create(input);
  return seq.toJSON();
}

export interface UpdateSequenceInput {
  name?: string;
  description?: string;
  status?: 'DRAFT' | 'ACTIVE' | 'PAUSED';
  scheduledStartAt?: Date;
  steps?: ISequenceStep[];
}

export async function updateSequence(id: string, input: UpdateSequenceInput) {
  const existing = await Sequence.findById(id);
  if (!existing) throw new Error('Not found');
  const becomingActive = input.status === 'ACTIVE' && existing.status !== 'ACTIVE';

  const seq = await Sequence.findByIdAndUpdate(id, input, { new: true, runValidators: true });
  if (!seq) throw new Error('Not found');

  if (becomingActive) {
    const baseTime = input.scheduledStartAt ?? new Date();
    const sortedSteps = [...seq.steps].sort((a, b) => a.order - b.order);
    const activeEnrollments = await Enrollment.find({ sequenceId: id, status: 'ACTIVE' });
    await Promise.all(
      activeEnrollments.map(async (enr) => {
        const step = sortedSteps[enr.currentStepIndex];
        if (!step) return;
        const nextSendAt = new Date(baseTime);
        nextSendAt.setDate(nextSendAt.getDate() + step.delayDays);
        enr.nextSendAt = nextSendAt;
        await enr.save();
      }),
    );
  }

  return seq.toJSON();
}

export async function deleteSequence(id: string) {
  const seq = await Sequence.findByIdAndDelete(id);
  if (!seq) throw new Error('Not found');
  // Remove all enrollments for this sequence
  await Enrollment.deleteMany({ sequenceId: id });
}

// ─── Enrollments ─────────────────────────────────────────────────────────────

export async function enrollEntity(sequenceId: string, entityId: string) {
  const sequence = await Sequence.findById(sequenceId);
  if (!sequence) throw new Error('Sequence not found');
  if (!sequence.steps.length) throw new Error('Sequence has no steps');

  // Resolve entity type and validate existence
  let entityEmail = '';
  let entityName = '';
  if (sequence.entityType === EntityType.INVESTOR) {
    const inv = await Investor.findById(entityId);
    if (!inv) throw new Error('Investor not found');
    entityEmail = inv.email;
    entityName = `${inv.firstName} ${inv.lastName}`.trim();
  } else {
    const par = await Partner.findById(entityId);
    if (!par) throw new Error('Partner not found');
    entityEmail = par.email;
    entityName = `${par.firstName} ${par.lastName}`.trim();
  }
  void entityEmail; void entityName; // used implicitly via entity lookup

  const firstStep = sequence.steps.sort((a, b) => a.order - b.order)[0]!;
  const nextSendAt = new Date();
  nextSendAt.setDate(nextSendAt.getDate() + firstStep.delayDays);

  const enrollment = await Enrollment.create({
    sequenceId,
    entityId,
    entityType: sequence.entityType,
    currentStepIndex: 0,
    nextSendAt,
    enrolledAt: new Date(),
  });
  return enrollment.toJSON();
}

export async function unenrollEntity(enrollmentId: string) {
  const enrollment = await Enrollment.findByIdAndUpdate(
    enrollmentId,
    { status: 'UNSUBSCRIBED' },
    { new: true },
  );
  if (!enrollment) throw new Error('Enrollment not found');
  return enrollment.toJSON();
}

export async function markReplied(enrollmentId: string) {
  const enrollment = await Enrollment.findByIdAndUpdate(
    enrollmentId,
    { status: 'REPLIED', completedAt: new Date() },
    { new: true },
  );
  if (!enrollment) throw new Error('Enrollment not found');
  return enrollment.toJSON();
}

export async function listEnrollments(sequenceId: string) {
  const enrollments = await Enrollment.find({ sequenceId }).sort({ enrolledAt: -1 }).lean();

  const sequence = await Sequence.findById(sequenceId).lean();
  const totalSteps = sequence?.steps.length ?? 0;

  // Batch resolve entity names
  const investorIds = enrollments.filter((e) => e.entityType === 'INVESTOR').map((e) => e.entityId);
  const partnerIds  = enrollments.filter((e) => e.entityType === 'PARTNER').map((e) => e.entityId);

  const [investors, partners] = await Promise.all([
    investorIds.length ? Investor.find({ _id: { $in: investorIds } }).select('firstName lastName email').lean() : [],
    partnerIds.length  ? Partner.find({ _id: { $in: partnerIds } }).select('firstName lastName email').lean() : [],
  ]);

  const invMap = new Map(investors.map((i) => [String(i._id), i]));
  const parMap = new Map(partners.map((p) => [String(p._id), p]));

  return enrollments.map((e) => {
    const entity = e.entityType === 'INVESTOR' ? invMap.get(String(e.entityId)) : parMap.get(String(e.entityId));
    return {
      ...e,
      id: String(e._id),
      _id: undefined,
      __v: undefined,
      entityName:  entity ? `${(entity as unknown as { firstName: string; lastName: string }).firstName ?? ''} ${(entity as unknown as { firstName: string; lastName: string }).lastName ?? ''}`.trim() || '—' : '—',
      entityEmail: entity?.email ?? '—',
      totalSteps,
    };
  });
}

export async function enrollAll(
  sequenceId: string,
  options: { notEnrolledInAnySequence?: boolean } = {},
): Promise<{ enrolled: number; skipped: number }> {
  const sequence = await Sequence.findById(sequenceId);
  if (!sequence) throw new Error('Sequence not found');
  if (!sequence.steps.length) throw new Error('Sequence has no steps');

  const existing = await Enrollment.find({ sequenceId }).select('entityId').lean();
  const enrolledInThisSequence = new Set(existing.map((e) => String(e.entityId)));

  let excludedIds = enrolledInThisSequence;
  if (options.notEnrolledInAnySequence) {
    const enrolledAnywhere = await Enrollment.distinct('entityId', { entityType: sequence.entityType, status: { $ne: 'UNSUBSCRIBED' } });
    excludedIds = new Set(enrolledAnywhere.map(String));
  }

  const Model = sequence.entityType === EntityType.INVESTOR ? Investor : Partner;
  const all = await Model.find().select('_id').lean();
  const unenrolled = all.filter((e) => !excludedIds.has(String(e._id)));

  const firstStep = sequence.steps.slice().sort((a, b) => a.order - b.order)[0]!;

  for (const entity of unenrolled) {
    const nextSendAt = new Date();
    nextSendAt.setDate(nextSendAt.getDate() + firstStep.delayDays);
    await Enrollment.create({
      sequenceId,
      entityId: entity._id,
      entityType: sequence.entityType,
      currentStepIndex: 0,
      nextSendAt,
      enrolledAt: new Date(),
    });
  }

  return { enrolled: unenrolled.length, skipped: enrolledInThisSequence.size };
}
