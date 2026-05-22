import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import {
  listCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  importCustomers,
} from '../../src/services/customer.service.js';
import { Customer } from '../../src/models/Customer.js';
import { Enrollment } from '../../src/models/Enrollment.js';
import { Sequence } from '../../src/models/Sequence.js';
import { Activity } from '../../src/models/Activity.js';
import { CustomerStage, EntityType } from '../../src/types/enums.js';

describe('Customer service', () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  const baseCustomer = {
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@customer.com',
    stage: CustomerStage.LEAD,
    tags: [] as string[],
  };

  // ─── createCustomer ────────────────────────────────────────────────────────

  describe('createCustomer', () => {
    it('creates a customer and logs CREATED activity', async () => {
      const customer = await createCustomer(baseCustomer);
      expect(customer.email).toBe('jane@customer.com');
      expect(customer.stage).toBe(CustomerStage.LEAD);
      const activity = await Activity.findOne({ customerId: customer._id });
      expect(activity?.type).toBe('CREATED');
    });

    it('throws on duplicate email', async () => {
      await createCustomer(baseCustomer);
      await expect(createCustomer(baseCustomer)).rejects.toThrow();
    });
  });

  // ─── listCustomers ─────────────────────────────────────────────────────────

  describe('listCustomers', () => {
    it('returns paginated data', async () => {
      await createCustomer(baseCustomer);
      await createCustomer({ ...baseCustomer, email: 'mark@customer.com', firstName: 'Mark' });
      const result = await listCustomers({ page: 1, limit: 10 });
      expect(result.total).toBe(2);
      expect(result.data).toHaveLength(2);
    });

    it('filters by stage', async () => {
      await createCustomer(baseCustomer);
      await createCustomer({ ...baseCustomer, email: 'won@customer.com', stage: CustomerStage.CLOSED_WON });
      const result = await listCustomers({ stage: CustomerStage.LEAD, page: 1, limit: 10 });
      expect(result.total).toBe(1);
      expect(result.data[0]!['email']).toBe('jane@customer.com');
    });

    it('searches by name', async () => {
      await createCustomer(baseCustomer);
      await createCustomer({ ...baseCustomer, email: 'other@customer.com', firstName: 'Other' });
      const result = await listCustomers({ search: 'Jane', page: 1, limit: 10 });
      expect(result.total).toBe(1);
    });

    it('searches by company', async () => {
      await createCustomer({ ...baseCustomer, company: 'AcmeCorp' });
      await createCustomer({ ...baseCustomer, email: 'other@customer.com', company: 'OtherCo' });
      const result = await listCustomers({ search: 'AcmeCorp', page: 1, limit: 10 });
      expect(result.total).toBe(1);
    });

    it('includes _count fields', async () => {
      await createCustomer(baseCustomer);
      const result = await listCustomers({ page: 1, limit: 10 });
      expect(result.data[0]!['_count']).toMatchObject({ emailLogs: 0 });
    });

    it('respects page and limit', async () => {
      for (let i = 0; i < 5; i++) {
        await createCustomer({ ...baseCustomer, email: `cust${i}@customer.com` });
      }
      const result = await listCustomers({ page: 1, limit: 2 });
      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(5);
      expect(result.pages).toBe(3);
    });

    it('filters out customers enrolled in any sequence when notEnrolledInAnySequence=true', async () => {
      const cust1 = await createCustomer(baseCustomer);
      await createCustomer({ ...baseCustomer, email: 'free@customer.com', firstName: 'Free' });

      const seq = await Sequence.create({ name: 'Seq', entityType: EntityType.CUSTOMER, status: 'DRAFT', steps: [] });
      await Enrollment.create({
        sequenceId: seq._id,
        entityId: cust1._id,
        entityType: 'CUSTOMER',
        status: 'ACTIVE',
        currentStepIndex: 0,
        nextSendAt: new Date(),
        enrolledAt: new Date(),
      });

      const result = await listCustomers({ notEnrolledInAnySequence: true, page: 1, limit: 10 });
      expect(result.total).toBe(1);
      expect(result.data[0]!['email']).toBe('free@customer.com');
    });

    it('includes UNSUBSCRIBED customers when notEnrolledInAnySequence=true', async () => {
      const cust1 = await createCustomer(baseCustomer);
      const cust2 = await createCustomer({ ...baseCustomer, email: 'free@customer.com', firstName: 'Free' });

      const seq = await Sequence.create({ name: 'Seq', entityType: EntityType.CUSTOMER, status: 'DRAFT', steps: [] });
      await Enrollment.create({
        sequenceId: seq._id, entityId: cust1._id, entityType: 'CUSTOMER',
        status: 'ACTIVE', currentStepIndex: 0, nextSendAt: new Date(), enrolledAt: new Date(),
      });
      await Enrollment.create({
        sequenceId: seq._id, entityId: cust2._id, entityType: 'CUSTOMER',
        status: 'UNSUBSCRIBED', currentStepIndex: 0, nextSendAt: new Date(), enrolledAt: new Date(),
      });

      const result = await listCustomers({ notEnrolledInAnySequence: true, page: 1, limit: 10 });
      expect(result.total).toBe(1);
      expect(result.data[0]!['email']).toBe('free@customer.com');
    });
  });

  // ─── getCustomerById ───────────────────────────────────────────────────────

  describe('getCustomerById', () => {
    it('returns customer with emailLogs and activities', async () => {
      const c = await createCustomer(baseCustomer);
      const result = await getCustomerById(String(c._id));
      expect(result).not.toBeNull();
      expect(result!.email).toBe('jane@customer.com');
      expect(Array.isArray(result!.emailLogs)).toBe(true);
      expect(Array.isArray(result!.activities)).toBe(true);
    });

    it('returns null for unknown id', async () => {
      const result = await getCustomerById('000000000000000000000000');
      expect(result).toBeNull();
    });
  });

  // ─── updateCustomer ────────────────────────────────────────────────────────

  describe('updateCustomer', () => {
    it('updates customer fields', async () => {
      const c = await createCustomer(baseCustomer);
      const updated = await updateCustomer(String(c._id), { company: 'NewCo' });
      expect(updated?.company).toBe('NewCo');
    });

    it('creates STAGE_CHANGE activity when stage changes', async () => {
      const c = await createCustomer(baseCustomer);
      await updateCustomer(String(c._id), { stage: CustomerStage.QUALIFIED });
      const activity = await Activity.findOne({ customerId: c._id, type: 'STAGE_CHANGE' });
      expect(activity).not.toBeNull();
      expect(activity!.detail).toContain('QUALIFIED');
    });

    it('does not create STAGE_CHANGE activity when stage unchanged', async () => {
      const c = await createCustomer(baseCustomer);
      await Activity.deleteMany({});
      await updateCustomer(String(c._id), { stage: CustomerStage.LEAD });
      const activity = await Activity.findOne({ type: 'STAGE_CHANGE' });
      expect(activity).toBeNull();
    });

    it('unenrolls active CUSTOMER enrollments when stage changes away from LEAD', async () => {
      const c = await createCustomer(baseCustomer);
      const seq = await Sequence.create({ name: 'Drip', entityType: 'CUSTOMER', status: 'ACTIVE', steps: [] });
      const enrollment = await Enrollment.create({
        sequenceId: seq._id, entityId: c._id, entityType: 'CUSTOMER',
        status: 'ACTIVE', currentStepIndex: 0, nextSendAt: new Date(), enrolledAt: new Date(),
      });
      await updateCustomer(String(c._id), { stage: CustomerStage.CLOSED_WON });
      const updated = await Enrollment.findById(enrollment._id);
      expect(updated?.status).toBe('UNSUBSCRIBED');
    });

    it('throws when customer not found', async () => {
      await expect(updateCustomer('000000000000000000000000', { company: 'X' })).rejects.toThrow('Not found');
    });
  });

  // ─── deleteCustomer ────────────────────────────────────────────────────────

  describe('deleteCustomer', () => {
    it('removes the customer', async () => {
      const c = await createCustomer(baseCustomer);
      await deleteCustomer(String(c._id));
      expect(await Customer.findById(c._id)).toBeNull();
    });

    it('throws when customer not found', async () => {
      await expect(deleteCustomer('000000000000000000000000')).rejects.toThrow('Not found');
    });
  });

  // ─── importCustomers ──────────────────────────────────────────────────────

  describe('importCustomers', () => {
    it('creates new customers from rows', async () => {
      const rows = [
        { firstName: 'Imp', lastName: 'One', email: 'imp1@ex.com', tags: [] as string[] },
        { firstName: 'Imp', lastName: 'Two', email: 'imp2@ex.com', tags: [] as string[] },
      ];
      const result = await importCustomers(rows);
      expect(result.created).toBe(2);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('updates existing customers by email', async () => {
      await createCustomer(baseCustomer);
      const rows = [{ firstName: 'Updated', lastName: 'Doe', email: 'jane@customer.com', tags: [] as string[] }];
      const result = await importCustomers(rows);
      expect(result.updated).toBe(1);
      expect(result.created).toBe(0);
    });

    it('reports error rows with invalid data', async () => {
      const rows = [
        { firstName: '', lastName: '', email: 'not-an-email', tags: [] as string[] },
      ];
      const result = await importCustomers(rows);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
