/**
 * Tests for the sequence scheduler processEnrollment logic.
 * We test the scheduler internals by directly calling exported functions.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { Enrollment } from '../../src/models/Enrollment.js';
import { Sequence } from '../../src/models/Sequence.js';
import { Investor } from '../../src/models/Investor.js';
import { Partner } from '../../src/models/Partner.js';
import { EmailLog } from '../../src/models/EmailLog.js';
import { Material } from '../../src/models/Material.js';
import { Activity } from '../../src/models/Activity.js';
import { EmailStatus } from '../../src/types/enums.js';

// Mock Resend before importing the scheduler
vi.mock('../../src/config/aws.js', () => ({
  resend: {
    emails: {
      send: vi.fn().mockResolvedValue({ data: { id: 'sched-email-id' }, error: null }),
    },
  },
}));

vi.mock('../../src/services/material.service.js', () => ({
  getMaterialBuffer: vi.fn().mockResolvedValue({ buffer: Buffer.from('pdf'), mimeType: 'application/pdf' }),
  uploadMaterial: vi.fn(),
  getMaterialForDownload: vi.fn(),
  deleteMaterial: vi.fn(),
  listMaterials: vi.fn(),
}));

// Import scheduler after mocks
import { processEnrollment, runSchedulerTick, startSequenceScheduler } from '../../src/services/sequence.scheduler.js';

describe('processEnrollment', () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  async function createInvestorWithSequence(opts: {
    steps?: { order: number; subject: string; bodyHtml: string; delayDays: number; materialId?: string }[];
    sequenceStatus?: string;
    enrollmentStatus?: string;
    currentStepIndex?: number;
    stepsLog?: { stepIndex: number; sentAt: Date; emailLogId: mongoose.Types.ObjectId }[];
  } = {}) {
    const steps = opts.steps ?? [
      { order: 1, subject: 'Step 1 {{first_name}}', bodyHtml: '<p>Hi {{name}}</p>', delayDays: 0 },
      { order: 2, subject: 'Step 2', bodyHtml: '<p>Follow up</p>', delayDays: 1 },
    ];
    const inv = await Investor.create({ firstName: 'John', lastName: 'Doe', email: 'john@test.com', tags: [] });
    const seq = await Sequence.create({
      name: 'Test Seq', entityType: 'INVESTOR',
      status: opts.sequenceStatus ?? 'ACTIVE',
      steps,
    });
    const enrollment = await Enrollment.create({
      sequenceId: seq._id,
      entityId: inv._id,
      entityType: 'INVESTOR',
      currentStepIndex: opts.currentStepIndex ?? 0,
      nextSendAt: new Date(Date.now() - 1000),
      enrolledAt: new Date(),
      status: opts.enrollmentStatus ?? 'ACTIVE',
      stepsLog: opts.stepsLog ?? [],
    });
    return { inv, seq, enrollment };
  }

  it('does nothing when enrollment ID does not exist', async () => {
    await processEnrollment(new mongoose.Types.ObjectId().toHexString());
    expect(await EmailLog.countDocuments()).toBe(0);
  });

  it('does nothing when enrollment is not ACTIVE', async () => {
    const { enrollment } = await createInvestorWithSequence({ enrollmentStatus: 'UNSUBSCRIBED' });
    await processEnrollment(String(enrollment._id));
    expect(await EmailLog.countDocuments()).toBe(0);
  });

  it('does nothing when sequence is not ACTIVE', async () => {
    const { enrollment } = await createInvestorWithSequence({ sequenceStatus: 'PAUSED' });
    await processEnrollment(String(enrollment._id));
    expect(await EmailLog.countDocuments()).toBe(0);
  });

  it('does nothing when currentStepIndex is out of bounds', async () => {
    const { enrollment } = await createInvestorWithSequence({ currentStepIndex: 99 });
    await processEnrollment(String(enrollment._id));
    expect(await EmailLog.countDocuments()).toBe(0);
  });

  it('sends email and advances enrollment to next step', async () => {
    const { enrollment } = await createInvestorWithSequence();
    await processEnrollment(String(enrollment._id));

    const updated = await Enrollment.findById(enrollment._id);
    expect(updated!.currentStepIndex).toBe(1);
    expect(updated!.status).toBe('ACTIVE');
    expect(updated!.stepsLog).toHaveLength(1);
    expect(updated!.stepsLog[0].stepIndex).toBe(0);

    const log = await EmailLog.findOne({});
    expect(log!.status).toBe(EmailStatus.SENT);
    expect(log!.subject).toBe('Step 1 John'); // first_name interpolated

    const activity = await Activity.findOne({ type: 'EMAIL_SENT' });
    expect(activity).not.toBeNull();
  });

  it('completes enrollment when last step is sent', async () => {
    const { enrollment } = await createInvestorWithSequence({
      steps: [{ order: 1, subject: 'Only step', bodyHtml: '<p>Only</p>', delayDays: 0 }],
    });
    await processEnrollment(String(enrollment._id));

    const updated = await Enrollment.findById(enrollment._id);
    expect(updated!.status).toBe('COMPLETED');
    expect(updated!.completedAt).toBeDefined();
  });

  it('handles alreadySent guard and advances without re-sending', async () => {
    const { enrollment } = await createInvestorWithSequence({
      stepsLog: [{ stepIndex: 0, sentAt: new Date(), emailLogId: new mongoose.Types.ObjectId() }],
    });
    await processEnrollment(String(enrollment._id));

    const updated = await Enrollment.findById(enrollment._id);
    // Should have advanced past step 0 without creating a new email log
    expect(updated!.currentStepIndex).toBe(1);
    expect(await EmailLog.countDocuments()).toBe(0);
  });

  it('alreadySent guard completes enrollment if it was the last step', async () => {
    const { enrollment } = await createInvestorWithSequence({
      steps: [{ order: 1, subject: 'S', bodyHtml: '<p>B</p>', delayDays: 0 }],
      stepsLog: [{ stepIndex: 0, sentAt: new Date(), emailLogId: new mongoose.Types.ObjectId() }],
    });
    await processEnrollment(String(enrollment._id));

    const updated = await Enrollment.findById(enrollment._id);
    expect(updated!.status).toBe('COMPLETED');
  });

  it('marks enrollment UNSUBSCRIBED when investor is not found', async () => {
    const { enrollment } = await createInvestorWithSequence();
    await Investor.findByIdAndDelete(enrollment.entityId);
    await processEnrollment(String(enrollment._id));

    const updated = await Enrollment.findById(enrollment._id);
    expect(updated!.status).toBe('UNSUBSCRIBED');
    expect(await EmailLog.countDocuments()).toBe(0);
  });

  it('processes a PARTNER enrollment correctly', async () => {
    const par = await Partner.create({ firstName: 'Jane', lastName: 'Smith', email: 'jane@test.com', tags: [] });
    const seq = await Sequence.create({
      name: 'Partner Seq', entityType: 'PARTNER', status: 'ACTIVE',
      steps: [{ order: 1, subject: 'Hi {{first_name}}', bodyHtml: '<p>Hello</p>', delayDays: 0 }],
    });
    const enrollment = await Enrollment.create({
      sequenceId: seq._id, entityId: par._id, entityType: 'PARTNER',
      currentStepIndex: 0, nextSendAt: new Date(Date.now() - 1000),
      enrolledAt: new Date(), status: 'ACTIVE', stepsLog: [],
    });

    await processEnrollment(String(enrollment._id));

    const updated = await Enrollment.findById(enrollment._id);
    expect(updated!.status).toBe('COMPLETED'); // single step → COMPLETED
    const log = await EmailLog.findOne({});
    expect(log!.status).toBe(EmailStatus.SENT);
    expect(log!.subject).toBe('Hi Jane');
  });

  it('marks enrollment UNSUBSCRIBED when partner is not found', async () => {
    const par = await Partner.create({ firstName: 'Gone', lastName: 'Away', email: 'gone@test.com', tags: [] });
    const seq = await Sequence.create({
      name: 'P Seq', entityType: 'PARTNER', status: 'ACTIVE',
      steps: [{ order: 1, subject: 'S', bodyHtml: '<p>B</p>', delayDays: 0 }],
    });
    const enrollment = await Enrollment.create({
      sequenceId: seq._id, entityId: par._id, entityType: 'PARTNER',
      currentStepIndex: 0, nextSendAt: new Date(Date.now() - 1000),
      enrolledAt: new Date(), status: 'ACTIVE', stepsLog: [],
    });
    await Partner.findByIdAndDelete(par._id);

    await processEnrollment(String(enrollment._id));

    const updated = await Enrollment.findById(enrollment._id);
    expect(updated!.status).toBe('UNSUBSCRIBED');
  });

  it('marks email log FAILED and does not advance when Resend throws', async () => {
    const { resend } = await import('../../src/config/aws.js');
    vi.mocked(resend.emails.send).mockRejectedValueOnce(new Error('SMTP down'));

    const { enrollment } = await createInvestorWithSequence();
    await processEnrollment(String(enrollment._id));

    const updated = await Enrollment.findById(enrollment._id);
    // currentStepIndex should NOT advance on failure
    expect(updated!.currentStepIndex).toBe(0);
    expect(updated!.stepsLog).toHaveLength(0);

    const log = await EmailLog.findOne({});
    expect(log!.status).toBe(EmailStatus.FAILED);
  });

  it('marks email log FAILED when Resend returns an error object', async () => {
    const { resend } = await import('../../src/config/aws.js');
    vi.mocked(resend.emails.send).mockResolvedValueOnce({ data: null, error: { message: 'Rate limited', name: 'rate_limit_exceeded', statusCode: 429 } });

    const { enrollment } = await createInvestorWithSequence();
    await processEnrollment(String(enrollment._id));

    const log = await EmailLog.findOne({});
    expect(log!.status).toBe(EmailStatus.FAILED);
  });

  it('creates a FILE_MISSING log and does not send or advance when material file is missing', async () => {
    const { getMaterialBuffer } = await import('../../src/services/material.service.js');
    vi.mocked(getMaterialBuffer).mockRejectedValueOnce(new Error('ENOENT: no such file or directory'));

    const material = await Material.create({
      name: 'Deck.pdf', fileKey: 'investor/deck.pdf',
      mimeType: 'application/pdf', sizeBytes: 1024, entityType: 'INVESTOR',
    });
    const { enrollment } = await createInvestorWithSequence({
      steps: [{ order: 1, subject: 'Step 1', bodyHtml: '<p>Hi</p>', delayDays: 0, materialId: String(material._id) }],
    });

    const { resend } = await import('../../src/config/aws.js');
    vi.mocked(resend.emails.send).mockClear();

    await processEnrollment(String(enrollment._id));

    // Enrollment must NOT advance
    const updated = await Enrollment.findById(enrollment._id);
    expect(updated!.currentStepIndex).toBe(0);
    expect(updated!.stepsLog).toHaveLength(0);

    // A single FILE_MISSING log must be created with a descriptive message
    const log = await EmailLog.findOne({ status: EmailStatus.FILE_MISSING });
    expect(log).not.toBeNull();
    expect(log!.errorMessage).toContain('Deck.pdf');

    // No actual email must have been sent
    expect(vi.mocked(resend.emails.send)).not.toHaveBeenCalled();
  });

  it('does not create duplicate FILE_MISSING logs when retrying the same step', async () => {
    const { getMaterialBuffer } = await import('../../src/services/material.service.js');
    vi.mocked(getMaterialBuffer).mockRejectedValue(new Error('ENOENT: no such file or directory'));

    const material = await Material.create({
      name: 'Deck.pdf', fileKey: 'investor/deck.pdf',
      mimeType: 'application/pdf', sizeBytes: 1024, entityType: 'INVESTOR',
    });
    const { enrollment } = await createInvestorWithSequence({
      steps: [{ order: 1, subject: 'Step 1', bodyHtml: '<p>Hi</p>', delayDays: 0, materialId: String(material._id) }],
    });

    // Simulate two scheduler ticks while the file is still missing
    await processEnrollment(String(enrollment._id));
    await processEnrollment(String(enrollment._id));

    // Only one FILE_MISSING log must exist — no duplicates
    expect(await EmailLog.countDocuments({ status: EmailStatus.FILE_MISSING })).toBe(1);

    // Reset mock back to success for subsequent tests
    vi.mocked(getMaterialBuffer).mockResolvedValue({ buffer: Buffer.from('pdf'), mimeType: 'application/pdf' });
  });
});

describe('runSchedulerTick', () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    // Reset the mock back to success
    const { resend } = await import('../../src/config/aws.js');
    vi.mocked(resend.emails.send).mockResolvedValue({ data: { id: 'tick-email-id' }, error: null });
  });

  it('does nothing when no ACTIVE due enrollment exists', async () => {
    await runSchedulerTick();
    expect(await EmailLog.countDocuments()).toBe(0);
  });

  it('processes a due enrollment when found', async () => {
    const inv = await Investor.create({ firstName: 'Tick', lastName: 'Tock', email: 'tick@test.com', tags: [] });
    const seq = await Sequence.create({
      name: 'Tick Seq', entityType: 'INVESTOR', status: 'ACTIVE',
      steps: [{ order: 1, subject: 'Tick', bodyHtml: '<p>T</p>', delayDays: 0 }],
    });
    await Enrollment.create({
      sequenceId: seq._id, entityId: inv._id, entityType: 'INVESTOR',
      currentStepIndex: 0, nextSendAt: new Date(Date.now() - 1000),
      enrolledAt: new Date(), status: 'ACTIVE', stepsLog: [],
    });

    await runSchedulerTick();

    expect(await EmailLog.countDocuments()).toBe(1);
  });

  it('respects daily cap and does nothing when 100 emails already sent today', async () => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    await EmailLog.insertMany(
      Array.from({ length: 100 }, (_, i) => ({
        subject: `S${i}`, body: 'B', status: EmailStatus.SENT, sentAt: new Date(),
      })),
    );

    const inv = await Investor.create({ firstName: 'Cap', lastName: 'Test', email: 'cap@test.com', tags: [] });
    const seq = await Sequence.create({
      name: 'Cap Seq', entityType: 'INVESTOR', status: 'ACTIVE',
      steps: [{ order: 1, subject: 'S', bodyHtml: '<p>B</p>', delayDays: 0 }],
    });
    await Enrollment.create({
      sequenceId: seq._id, entityId: inv._id, entityType: 'INVESTOR',
      currentStepIndex: 0, nextSendAt: new Date(Date.now() - 1000),
      enrolledAt: new Date(), status: 'ACTIVE', stepsLog: [],
    });

    await runSchedulerTick();

    // No new email log should be created (101st email blocked)
    expect(await EmailLog.countDocuments()).toBe(100);
  });
});

describe('startSequenceScheduler', () => {
  it('can be called without throwing', () => {
    vi.useFakeTimers();
    try {
      expect(() => startSequenceScheduler()).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});
