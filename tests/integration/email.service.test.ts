import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { sendEmail, getEmailLogs, listAllEmailLogs, getEmailStats } from '../../src/services/email.service.js';
import { EmailLog } from '../../src/models/EmailLog.js';
import { Investor } from '../../src/models/Investor.js';
import { Partner } from '../../src/models/Partner.js';
import { EntityType, EmailStatus } from '../../src/types/enums.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../src/config/aws.js', () => ({
  resend: {
    emails: {
      send: vi.fn().mockResolvedValue({ data: { id: 'mock-ses-id' }, error: null }),
    },
  },
}));

vi.mock('../../src/services/material.service.js', () => ({
  getMaterialBuffer: vi.fn().mockResolvedValue({ buffer: Buffer.from('pdf-content'), mimeType: 'application/pdf', name: 'doc.pdf' }),
  uploadMaterial: vi.fn(),
  getMaterialForDownload: vi.fn(),
  deleteMaterial: vi.fn(),
  listMaterials: vi.fn(),
}));

describe('Email service', () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  const investorData = { firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', tags: [] as string[] };
  const partnerData = { firstName: 'Bob', lastName: 'Jones', email: 'bob@partner.com', tags: [] as string[] };

  // ─── sendEmail ─────────────────────────────────────────────────────────────

  describe('sendEmail', () => {
    it('sends to an investor and creates email log', async () => {
      const inv = await Investor.create(investorData);
      const result = await sendEmail({
        entityId: String(inv._id),
        entityType: EntityType.INVESTOR,
        subject: 'Hello {{first_name}}',
        body: '<p>Hi {{name}}</p>',
        materialIds: [],
      });
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('mock-ses-id');
      const log = await EmailLog.findById(result.emailLogId);
      expect(log?.status).toBe(EmailStatus.SENT);
      expect(log?.subject).toBe('Hello Alice');
    });

    it('sends to a partner and creates email log', async () => {
      const par = await Partner.create(partnerData);
      const result = await sendEmail({
        entityId: String(par._id),
        entityType: EntityType.PARTNER,
        subject: 'Hi {{first_name}}',
        body: '<p>Hello {{last_name}}</p>',
        materialIds: [],
      });
      expect(result.success).toBe(true);
      const log = await EmailLog.findById(result.emailLogId);
      expect(log?.subject).toBe('Hi Bob');
    });

    it('throws when investor not found', async () => {
      await expect(
        sendEmail({
          entityId: '000000000000000000000000',
          entityType: EntityType.INVESTOR,
          subject: 'Test',
          body: 'Test body',
          materialIds: [],
        }),
      ).rejects.toThrow('Not found');
    });

    it('throws when partner not found', async () => {
      await expect(
        sendEmail({
          entityId: '000000000000000000000000',
          entityType: EntityType.PARTNER,
          subject: 'Test',
          body: 'Test body',
          materialIds: [],
        }),
      ).rejects.toThrow('Not found');
    });

    it('enforces daily email cap of 100', async () => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      // Insert 100 sent emails today
      const logs = Array.from({ length: 100 }, (_, i) => ({
        subject: `Email ${i}`,
        body: 'body',
        status: EmailStatus.SENT,
        sentAt: new Date(),
      }));
      await EmailLog.insertMany(logs);
      const inv = await Investor.create(investorData);
      await expect(
        sendEmail({
          entityId: String(inv._id),
          entityType: EntityType.INVESTOR,
          subject: 'Over limit',
          body: 'Body',
          materialIds: [],
        }),
      ).rejects.toThrow('Daily email limit');
    });

    it('marks email as FAILED when resend returns an error', async () => {
      const { resend: mockResend } = await import('../../src/config/aws.js');
      (mockResend.emails.send as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        data: null,
        error: { message: 'Resend API error' },
      });
      const inv = await Investor.create({ ...investorData, email: 'fail@example.com' });
      await expect(
        sendEmail({ entityId: String(inv._id), entityType: EntityType.INVESTOR, subject: 'Fail', body: 'body', materialIds: [] }),
      ).rejects.toThrow('Resend API error');
      const log = await EmailLog.findOne({ subject: 'Fail' });
      expect(log?.status).toBe(EmailStatus.FAILED);
    });
  });

  // ─── getEmailLogs ──────────────────────────────────────────────────────────

  describe('getEmailLogs', () => {
    it('returns logs for an investor', async () => {
      const inv = await Investor.create(investorData);
      await EmailLog.create({ subject: 'S1', body: 'B1', investorId: inv._id, status: EmailStatus.SENT });
      const logs = await getEmailLogs(String(inv._id), EntityType.INVESTOR);
      expect(logs).toHaveLength(1);
    });

    it('returns logs for a partner', async () => {
      const par = await Partner.create(partnerData);
      await EmailLog.create({ subject: 'S2', body: 'B2', partnerId: par._id, status: EmailStatus.SENT });
      const logs = await getEmailLogs(String(par._id), EntityType.PARTNER);
      expect(logs).toHaveLength(1);
    });
  });

  // ─── listAllEmailLogs ──────────────────────────────────────────────────────

  describe('listAllEmailLogs', () => {
    it('returns all logs with enriched entity data', async () => {
      const inv = await Investor.create(investorData);
      await EmailLog.create({ subject: 'Sub', body: 'Body', investorId: inv._id, status: EmailStatus.SENT });
      const logs = await listAllEmailLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0]!['recipientEmail']).toBe('alice@example.com');
      expect(logs[0]!['entityType']).toBe('INVESTOR');
    });

    it('handles logs with unknown entity gracefully', async () => {
      await EmailLog.create({ subject: 'S', body: 'B', investorId: '000000000000000000000001', status: EmailStatus.SENT });
      const logs = await listAllEmailLogs();
      expect(logs[0]!['recipientName']).toBe('—');
    });
  });

  // ─── getEmailStats ─────────────────────────────────────────────────────────

  describe('getEmailStats', () => {
    it('returns sentToday count', async () => {
      await EmailLog.create({ subject: 'S', body: 'B', status: EmailStatus.SENT, sentAt: new Date() });
      const stats = await getEmailStats();
      expect(stats.sentToday).toBe(1);
    });

    it('returns 0 when no emails sent today', async () => {
      const stats = await getEmailStats();
      expect(stats.sentToday).toBe(0);
    });
  });
});
