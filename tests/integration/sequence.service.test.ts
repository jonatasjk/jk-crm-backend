import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import {
  listSequences,
  getSequenceById,
  createSequence,
  updateSequence,
  deleteSequence,
  enrollEntity,
  unenrollEntity,
  markReplied,
  listEnrollments,
  enrollAll,
} from '../../src/services/sequence.service.js';
import { Sequence } from '../../src/models/Sequence.js';
import { Enrollment } from '../../src/models/Enrollment.js';
import { Investor } from '../../src/models/Investor.js';
import { Partner } from '../../src/models/Partner.js';
import { EntityType } from '../../src/types/enums.js';

describe('Sequence service', () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  const baseSeqInput = {
    name: 'Onboarding',
    entityType: EntityType.INVESTOR,
  } as const;

  const stepDef = {
    order: 1,
    subject: 'Welcome {{first_name}}',
    bodyHtml: '<p>Hello {{name}}</p>',
    delayDays: 0,
  };

  async function createSeqWithStep() {
    const seq = await createSequence(baseSeqInput);
    await Sequence.findByIdAndUpdate(seq.id, { steps: [stepDef] });
    return (await Sequence.findById(seq.id))!;
  }

  async function createInvestor(email = 'inv@test.com') {
    return Investor.create({ firstName: 'Test', lastName: 'Inv', email, tags: [] });
  }

  async function createPartner(email = 'par@test.com') {
    return Partner.create({ firstName: 'Test', lastName: 'Par', email, tags: [] });
  }

  // ─── createSequence ────────────────────────────────────────────────────────

  describe('createSequence', () => {
    it('creates a sequence with DRAFT status', async () => {
      const seq = await createSequence(baseSeqInput);
      expect(seq.name).toBe('Onboarding');
      expect(seq.status).toBe('DRAFT');
    });
  });

  // ─── listSequences ─────────────────────────────────────────────────────────

  describe('listSequences', () => {
    it('returns sequences with enrollment counts', async () => {
      await createSequence(baseSeqInput);
      const result = await listSequences();
      expect(result).toHaveLength(1);
      expect(result[0]!['enrollments']).toMatchObject({ total: 0, active: 0 });
    });
  });

  // ─── getSequenceById ───────────────────────────────────────────────────────

  describe('getSequenceById', () => {
    it('returns sequence by id', async () => {
      const seq = await createSequence(baseSeqInput);
      const result = await getSequenceById(seq.id as string);
      expect(result?.name).toBe('Onboarding');
    });

    it('returns null for unknown id', async () => {
      const result = await getSequenceById('000000000000000000000000');
      expect(result).toBeNull();
    });
  });

  // ─── updateSequence ────────────────────────────────────────────────────────

  describe('updateSequence', () => {
    it('updates sequence name', async () => {
      const seq = await createSequence(baseSeqInput);
      const updated = await updateSequence(seq.id as string, { name: 'New Name' });
      expect(updated.name).toBe('New Name');
    });

    it('throws when sequence not found', async () => {
      await expect(updateSequence('000000000000000000000000', { name: 'X' })).rejects.toThrow('Not found');
    });

    it('reschedules active enrollments when becoming ACTIVE', async () => {
      const seq = await createSeqWithStep();
      const inv = await createInvestor();
      // Enroll before activating
      await Enrollment.create({
        sequenceId: seq._id,
        entityId: inv._id,
        entityType: EntityType.INVESTOR,
        currentStepIndex: 0,
        nextSendAt: new Date(),
        enrolledAt: new Date(),
      });
      await updateSequence(String(seq._id), { status: 'ACTIVE' });
      const enrollment = await Enrollment.findOne({ sequenceId: seq._id });
      expect(enrollment?.nextSendAt).toBeDefined();
    });
  });

  // ─── deleteSequence ────────────────────────────────────────────────────────

  describe('deleteSequence', () => {
    it('removes sequence and its enrollments', async () => {
      const seq = await createSeqWithStep();
      const inv = await createInvestor();
      await Enrollment.create({
        sequenceId: seq._id,
        entityId: inv._id,
        entityType: EntityType.INVESTOR,
        currentStepIndex: 0,
        nextSendAt: new Date(),
        enrolledAt: new Date(),
      });
      await deleteSequence(String(seq._id));
      expect(await Sequence.findById(seq._id)).toBeNull();
      expect(await Enrollment.countDocuments({ sequenceId: seq._id })).toBe(0);
    });

    it('throws when sequence not found', async () => {
      await expect(deleteSequence('000000000000000000000000')).rejects.toThrow('Not found');
    });
  });

  // ─── enrollEntity ──────────────────────────────────────────────────────────

  describe('enrollEntity', () => {
    it('enrolls an investor in a sequence', async () => {
      const seq = await createSeqWithStep();
      const inv = await createInvestor();
      const enrollment = await enrollEntity(String(seq._id), String(inv._id));
      expect(enrollment.status).toBe('ACTIVE');
      expect(enrollment.entityType).toBe(EntityType.INVESTOR);
    });

    it('enrolls a partner in a partner sequence', async () => {
      const partnerSeq = await createSequence({ name: 'Partner Seq', entityType: EntityType.PARTNER });
      await Sequence.findByIdAndUpdate(partnerSeq.id, { steps: [stepDef] });
      const par = await createPartner();
      const enrollment = await enrollEntity(partnerSeq.id as string, String(par._id));
      expect(enrollment.entityType).toBe(EntityType.PARTNER);
    });

    it('throws when sequence not found', async () => {
      await expect(enrollEntity('000000000000000000000000', '000000000000000000000001')).rejects.toThrow('Sequence not found');
    });

    it('throws when sequence has no steps', async () => {
      const empty = await createSequence(baseSeqInput);
      const inv = await createInvestor('empty@test.com');
      await expect(enrollEntity(empty.id as string, String(inv._id))).rejects.toThrow('Sequence has no steps');
    });

    it('throws when investor not found', async () => {
      const seq = await createSeqWithStep();
      await expect(enrollEntity(String(seq._id), '000000000000000000000001')).rejects.toThrow('Investor not found');
    });

    it('throws when partner not found', async () => {
      const partnerSeq = await createSequence({ name: 'PSeq', entityType: EntityType.PARTNER });
      await Sequence.findByIdAndUpdate(partnerSeq.id, { steps: [stepDef] });
      await expect(enrollEntity(partnerSeq.id as string, '000000000000000000000001')).rejects.toThrow('Partner not found');
    });
  });

  // ─── unenrollEntity ────────────────────────────────────────────────────────

  describe('unenrollEntity', () => {
    it('sets enrollment status to UNSUBSCRIBED', async () => {
      const seq = await createSeqWithStep();
      const inv = await createInvestor('unenroll@test.com');
      const enrollment = await enrollEntity(String(seq._id), String(inv._id));
      const result = await unenrollEntity(enrollment.id as string);
      expect(result.status).toBe('UNSUBSCRIBED');
    });

    it('throws when enrollment not found', async () => {
      await expect(unenrollEntity('000000000000000000000000')).rejects.toThrow('Enrollment not found');
    });
  });

  // ─── markReplied ───────────────────────────────────────────────────────────

  describe('markReplied', () => {
    it('sets enrollment status to REPLIED', async () => {
      const seq = await createSeqWithStep();
      const inv = await createInvestor('replied@test.com');
      const enrollment = await enrollEntity(String(seq._id), String(inv._id));
      const result = await markReplied(enrollment.id as string);
      expect(result.status).toBe('REPLIED');
      expect(result.completedAt).toBeDefined();
    });

    it('throws when enrollment not found', async () => {
      await expect(markReplied('000000000000000000000000')).rejects.toThrow('Enrollment not found');
    });
  });

  // ─── listEnrollments ───────────────────────────────────────────────────────

  describe('listEnrollments', () => {
    it('lists enrollments with entity details', async () => {
      const seq = await createSeqWithStep();
      const inv = await createInvestor('list@test.com');
      await enrollEntity(String(seq._id), String(inv._id));
      const result = await listEnrollments(String(seq._id));
      expect(result).toHaveLength(1);
      expect(result[0]!['entityEmail']).toBe('list@test.com');
    });

    it('returns empty array when no enrollments', async () => {
      const seq = await createSequence(baseSeqInput);
      const result = await listEnrollments(String(seq.id));
      expect(result).toHaveLength(0);
    });
  });

  // ─── enrollAll ─────────────────────────────────────────────────────────────

  describe('enrollAll', () => {
    it('enrolls all investors not yet enrolled', async () => {
      const seq = await createSeqWithStep();
      await createInvestor('a@test.com');
      await createInvestor('b@test.com');
      const result = await enrollAll(String(seq._id));
      expect(result.enrolled).toBe(2);
      expect(result.skipped).toBe(0);
    });

    it('skips already enrolled investors', async () => {
      const seq = await createSeqWithStep();
      const inv = await createInvestor();
      await enrollEntity(String(seq._id), String(inv._id));
      await createInvestor('b2@test.com');
      const result = await enrollAll(String(seq._id));
      expect(result.enrolled).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('throws when sequence not found', async () => {
      await expect(enrollAll('000000000000000000000000')).rejects.toThrow('Sequence not found');
    });

    it('throws when sequence has no steps', async () => {
      const empty = await createSequence(baseSeqInput);
      await expect(enrollAll(empty.id as string)).rejects.toThrow('Sequence has no steps');
    });
  });
});
