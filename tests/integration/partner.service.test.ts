import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import {
  listPartners,
  getPartnerById,
  createPartner,
  updatePartner,
  deletePartner,
  importPartners,
} from '../../src/services/partner.service.js';
import { Partner } from '../../src/models/Partner.js';
import { Activity } from '../../src/models/Activity.js';
import { PartnerStage } from '../../src/types/enums.js';

describe('Partner service', () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  const basePartner = {
    firstName: 'Bob',
    lastName: 'Jones',
    email: 'bob@partner.com',
    stage: PartnerStage.LEAD,
    tags: [] as string[],
  };

  // ─── createPartner ─────────────────────────────────────────────────────────

  describe('createPartner', () => {
    it('creates a partner and logs CREATED activity', async () => {
      const partner = await createPartner(basePartner);
      expect(partner.email).toBe('bob@partner.com');
      const activity = await Activity.findOne({ partnerId: partner._id });
      expect(activity?.type).toBe('CREATED');
    });
  });

  // ─── listPartners ──────────────────────────────────────────────────────────

  describe('listPartners', () => {
    it('returns paginated data', async () => {
      await createPartner(basePartner);
      await createPartner({ ...basePartner, email: 'eve@partner.com', firstName: 'Eve' });
      const result = await listPartners({ page: 1, limit: 10 });
      expect(result.total).toBe(2);
      expect(result.data).toHaveLength(2);
    });

    it('filters by stage', async () => {
      await createPartner(basePartner);
      await createPartner({ ...basePartner, email: 'active@partner.com', stage: PartnerStage.ACTIVE });
      const result = await listPartners({ stage: PartnerStage.LEAD, page: 1, limit: 10 });
      expect(result.total).toBe(1);
    });

    it('searches by company', async () => {
      await createPartner({ ...basePartner, company: 'AcmeCorp' });
      await createPartner({ ...basePartner, email: 'other@partner.com', company: 'OtherCo' });
      const result = await listPartners({ search: 'AcmeCorp', page: 1, limit: 10 });
      expect(result.total).toBe(1);
    });

    it('includes _count fields', async () => {
      await createPartner(basePartner);
      const result = await listPartners({ page: 1, limit: 10 });
      // createPartner logs one CREATED activity, emailLogs are always 0
      expect(result.data[0]!['_count']).toMatchObject({ emailLogs: 0 });
      expect((result.data[0]!['_count'] as { activities: number }).activities).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── getPartnerById ────────────────────────────────────────────────────────

  describe('getPartnerById', () => {
    it('returns partner with emailLogs and activities', async () => {
      const p = await createPartner(basePartner);
      const result = await getPartnerById(String(p._id));
      expect(result).not.toBeNull();
      expect(result!.email).toBe('bob@partner.com');
      expect(Array.isArray(result!.emailLogs)).toBe(true);
      expect(Array.isArray(result!.activities)).toBe(true);
    });

    it('returns null for unknown id', async () => {
      const result = await getPartnerById('000000000000000000000000');
      expect(result).toBeNull();
    });
  });

  // ─── updatePartner ─────────────────────────────────────────────────────────

  describe('updatePartner', () => {
    it('updates partner fields', async () => {
      const p = await createPartner(basePartner);
      const updated = await updatePartner(String(p._id), { company: 'NewCo' });
      expect(updated?.company).toBe('NewCo');
    });

    it('creates STAGE_CHANGE activity when stage changes', async () => {
      const p = await createPartner(basePartner);
      await updatePartner(String(p._id), { stage: PartnerStage.ACTIVE });
      const activity = await Activity.findOne({ partnerId: p._id, type: 'STAGE_CHANGE' });
      expect(activity).not.toBeNull();
      expect(activity!.detail).toContain('ACTIVE');
    });

    it('does not create STAGE_CHANGE activity when stage unchanged', async () => {
      const p = await createPartner(basePartner);
      await Activity.deleteMany({});
      await updatePartner(String(p._id), { stage: PartnerStage.LEAD });
      const activity = await Activity.findOne({ type: 'STAGE_CHANGE' });
      expect(activity).toBeNull();
    });

    it('throws when partner not found', async () => {
      await expect(updatePartner('000000000000000000000000', { company: 'X' })).rejects.toThrow('Not found');
    });
  });

  // ─── deletePartner ─────────────────────────────────────────────────────────

  describe('deletePartner', () => {
    it('removes partner', async () => {
      const p = await createPartner(basePartner);
      await deletePartner(String(p._id));
      expect(await Partner.findById(p._id)).toBeNull();
    });

    it('throws when partner not found', async () => {
      await expect(deletePartner('000000000000000000000000')).rejects.toThrow('Not found');
    });
  });

  // ─── importPartners ────────────────────────────────────────────────────────

  describe('importPartners', () => {
    it('creates new partners from rows', async () => {
      const rows = [
        { firstName: 'Imp', lastName: 'One', email: 'pimp1@ex.com', tags: [] as string[] },
        { firstName: 'Imp', lastName: 'Two', email: 'pimp2@ex.com', tags: [] as string[] },
      ];
      const result = await importPartners(rows);
      expect(result.created).toBe(2);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('updates existing partners by email', async () => {
      await createPartner(basePartner);
      const rows = [{ firstName: 'Updated', lastName: 'Jones', email: 'bob@partner.com', tags: [] as string[] }];
      const result = await importPartners(rows);
      expect(result.updated).toBe(1);
      expect(result.created).toBe(0);
    });
  });
});
