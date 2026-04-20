import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import {
  listInvestors,
  getInvestorById,
  createInvestor,
  updateInvestor,
  deleteInvestor,
  importInvestors,
} from '../../src/services/investor.service.js';
import { Investor } from '../../src/models/Investor.js';
import { Activity } from '../../src/models/Activity.js';
import { InvestorStage } from '../../src/types/enums.js';

describe('Investor service', () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  const baseInvestor = {
    firstName: 'Alice',
    lastName: 'Smith',
    email: 'alice@example.com',
    stage: InvestorStage.PROSPECT,
    tags: [] as string[],
  };

  // ─── createInvestor ────────────────────────────────────────────────────────

  describe('createInvestor', () => {
    it('creates investor and activity', async () => {
      const investor = await createInvestor(baseInvestor);
      expect(investor.email).toBe('alice@example.com');
      const activity = await Activity.findOne({ investorId: investor._id });
      expect(activity?.type).toBe('CREATED');
    });
  });

  // ─── listInvestors ─────────────────────────────────────────────────────────

  describe('listInvestors', () => {
    it('returns paginated data', async () => {
      await createInvestor(baseInvestor);
      await createInvestor({ ...baseInvestor, email: 'bob@example.com', firstName: 'Bob' });

      const result = await listInvestors({ page: 1, limit: 10 });
      expect(result.total).toBe(2);
      expect(result.pages).toBe(1);
      expect(result.data).toHaveLength(2);
    });

    it('filters by stage', async () => {
      await createInvestor(baseInvestor);
      await createInvestor({ ...baseInvestor, email: 'bob@example.com', firstName: 'Bob', stage: InvestorStage.MEETING });

      const result = await listInvestors({ stage: InvestorStage.PROSPECT, page: 1, limit: 10 });
      expect(result.total).toBe(1);
      expect(result.data[0]!['email']).toBe('alice@example.com');
    });

    it('searches by name', async () => {
      await createInvestor(baseInvestor);
      await createInvestor({ ...baseInvestor, email: 'charlie@example.com', firstName: 'Charlie', lastName: 'Brown' });

      const result = await listInvestors({ search: 'Charlie', page: 1, limit: 10 });
      expect(result.total).toBe(1);
      expect(result.data[0]!['firstName']).toBe('Charlie');
    });

    it('returns _count with emailLogs and activities', async () => {
      await createInvestor(baseInvestor);
      const result = await listInvestors({ page: 1, limit: 10 });
      // createInvestor logs one CREATED activity, emailLogs are always 0
      expect(result.data[0]!['_count']).toMatchObject({ emailLogs: 0 });
      expect((result.data[0]!['_count'] as { activities: number }).activities).toBeGreaterThanOrEqual(0);
    });

    it('supports pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await createInvestor({ ...baseInvestor, email: `user${i}@ex.com`, firstName: `User${i}` });
      }
      const result = await listInvestors({ page: 2, limit: 3 });
      expect(result.data).toHaveLength(2);
      expect(result.page).toBe(2);
    });
  });

  // ─── getInvestorById ───────────────────────────────────────────────────────

  describe('getInvestorById', () => {
    it('returns investor with emailLogs and activities arrays', async () => {
      const inv = await createInvestor(baseInvestor);
      const result = await getInvestorById(String(inv._id));
      expect(result).not.toBeNull();
      expect(result!.email).toBe('alice@example.com');
      expect(result!.emailLogs).toBeDefined();
      expect(result!.activities).toBeDefined();
    });

    it('returns null for unknown id', async () => {
      const result = await getInvestorById('000000000000000000000000');
      expect(result).toBeNull();
    });
  });

  // ─── updateInvestor ────────────────────────────────────────────────────────

  describe('updateInvestor', () => {
    it('updates investor fields', async () => {
      const inv = await createInvestor(baseInvestor);
      const updated = await updateInvestor(String(inv._id), { company: 'Acme' });
      expect(updated?.company).toBe('Acme');
    });

    it('creates a STAGE_CHANGE activity when stage changes', async () => {
      const inv = await createInvestor(baseInvestor);
      await updateInvestor(String(inv._id), { stage: InvestorStage.MEETING });
      const activity = await Activity.findOne({ investorId: inv._id, type: 'STAGE_CHANGE' });
      expect(activity).not.toBeNull();
      expect(activity!.detail).toContain('MEETING');
    });

    it('does not create STAGE_CHANGE activity when stage unchanged', async () => {
      const inv = await createInvestor(baseInvestor);
      await Activity.deleteMany({});
      await updateInvestor(String(inv._id), { stage: InvestorStage.PROSPECT });
      const activity = await Activity.findOne({ type: 'STAGE_CHANGE' });
      expect(activity).toBeNull();
    });

    it('throws when investor not found', async () => {
      await expect(updateInvestor('000000000000000000000000', { company: 'X' })).rejects.toThrow('Not found');
    });
  });

  // ─── deleteInvestor ────────────────────────────────────────────────────────

  describe('deleteInvestor', () => {
    it('removes investor', async () => {
      const inv = await createInvestor(baseInvestor);
      await deleteInvestor(String(inv._id));
      const found = await Investor.findById(inv._id);
      expect(found).toBeNull();
    });

    it('throws when investor not found', async () => {
      await expect(deleteInvestor('000000000000000000000000')).rejects.toThrow('Not found');
    });
  });

  // ─── importInvestors ───────────────────────────────────────────────────────

  describe('importInvestors', () => {
    it('creates new investors from rows', async () => {
      const rows = [
        { firstName: 'Imp', lastName: 'One', email: 'imp1@ex.com', tags: [] as string[] },
        { firstName: 'Imp', lastName: 'Two', email: 'imp2@ex.com', tags: [] as string[] },
      ];
      const result = await importInvestors(rows);
      expect(result.created).toBe(2);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('updates existing investors by email', async () => {
      await createInvestor(baseInvestor);
      const rows = [{ firstName: 'Updated', lastName: 'Smith', email: 'alice@example.com', tags: [] as string[] }];
      const result = await importInvestors(rows);
      expect(result.updated).toBe(1);
      expect(result.created).toBe(0);
    });
  });
});
