/**
 * Tests for investor/partner CSV import routes and the sequence scheduler.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { connectTestDB, disconnectTestDB, clearTestDB, createAdminUser } from '../helpers/db.js';
import { buildApp } from '../../src/app.js';

vi.mock('../../src/config/aws.js', () => ({
  resend: {
    emails: {
      send: vi.fn().mockResolvedValue({ data: { id: 'mock-id' }, error: null }),
    },
  },
}));

async function getAuthToken(app: FastifyInstance): Promise<string> {
  await createAdminUser('csv@test.com', 'password123', 'CSV Admin');
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'csv@test.com', password: 'password123' } });
  return res.json<{ token: string }>().token;
}

function makeMultipart(filename: string, mimeType: string, content: string): { body: Buffer; contentType: string } {
  const boundary = 'testboundary12345';
  const body = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n${content}\r\n--${boundary}--`,
  );
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

describe('CSV Import routes', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    await connectTestDB();
    app = await buildApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDB();
  });

  beforeEach(async () => {
    const mongoose = await import('mongoose');
    const collections = mongoose.default.connection.collections;
    for (const key of Object.keys(collections)) {
      if (key !== 'users') await collections[key]!.deleteMany({});
    }
  });

  // ─── Investor CSV import ───────────────────────────────────────────────

  describe('POST /investors/import', () => {
    it('imports valid investor CSV', async () => {
      const csv = 'first_name,last_name,email\nAlice,Smith,alice@csv.com\nBob,Jones,bob@csv.com\n';
      const { body, contentType } = makeMultipart('investors.csv', 'text/csv', csv);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/investors/import',
        headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
        body,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().created).toBe(2);
      expect(res.json().total).toBe(2);
    });

    it('returns 400 when no file uploaded', async () => {
      // Send form without file part — send empty multipart
      const boundary = 'emptyboundary';
      const body = Buffer.from(`--${boundary}--`);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/investors/import',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 422 for CSV with inconsistent columns', async () => {
      // Row 2 has fewer columns than the header declares
      const csv = 'first_name,last_name,email\nAlice\n';
      const { body, contentType } = makeMultipart('bad.csv', 'text/csv', csv);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/investors/import',
        headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
        body,
      });
      expect(res.statusCode).toBe(422);
    });

    it('collects parse errors for invalid rows', async () => {
      // Row with missing required email
      const csv = 'first_name,last_name,email\nNoEmail,Person,not-a-valid-email\n';
      const { body, contentType } = makeMultipart('invalid.csv', 'text/csv', csv);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/investors/import',
        headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
        body,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().parseErrors).toHaveLength(1);
      expect(res.json().created).toBe(0);
    });
  });

  // ─── Partner CSV import ────────────────────────────────────────────────

  describe('POST /partners/import', () => {
    it('imports valid partner CSV', async () => {
      const csv = 'first_name,last_name,email\nEve,Green,eve@csv.com\nFrank,Black,frank@csv.com\n';
      const { body, contentType } = makeMultipart('partners.csv', 'text/csv', csv);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/partners/import',
        headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
        body,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().created).toBe(2);
    });

    it('returns 400 when no file uploaded', async () => {
      const boundary = 'emptyboundary2';
      const body = Buffer.from(`--${boundary}--`);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/partners/import',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 422 for CSV with inconsistent columns', async () => {
      const csv = 'first_name,last_name,email\nEve\n';
      const { body, contentType } = makeMultipart('bad.csv', 'text/csv', csv);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/partners/import',
        headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
        body,
      });
      expect(res.statusCode).toBe(422);
    });
  });

  // ─── Customer CSV import ───────────────────────────────────────────────

  describe('POST /customers/import', () => {
    it('imports valid customer CSV', async () => {
      const csv = 'first_name,last_name,email\nNia,Brooks,nia@csv.com\nOscar,Webb,oscar@csv.com\n';
      const { body, contentType } = makeMultipart('customers.csv', 'text/csv', csv);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/customers/import',
        headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
        body,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().created).toBe(2);
      expect(res.json().total).toBe(2);
    });

    it('updates existing customer on duplicate email', async () => {
      // Pre-create one customer
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/customers',
        headers: { authorization: `Bearer ${token}` },
        payload: { firstName: 'Nia', lastName: 'Brooks', email: 'nia@csv.com' },
      });
      expect(createRes.statusCode).toBe(201);

      const csv = 'first_name,last_name,email,company\nNia,Brooks,nia@csv.com,BrooksCo\n';
      const { body, contentType } = makeMultipart('customers.csv', 'text/csv', csv);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/customers/import',
        headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
        body,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().updated).toBe(1);
      expect(res.json().created).toBe(0);
    });

    it('returns 400 when no file uploaded', async () => {
      const boundary = 'emptyboundary3';
      const body = Buffer.from(`--${boundary}--`);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/customers/import',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 422 for CSV with inconsistent columns', async () => {
      const csv = 'first_name,last_name,email\nNia\n';
      const { body, contentType } = makeMultipart('bad.csv', 'text/csv', csv);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/customers/import',
        headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
        body,
      });
      expect(res.statusCode).toBe(422);
    });

    it('imports customers with CLOSED_WON stage', async () => {
      const csv = 'first_name,last_name,email,stage\nPat,Clay,pat@csv.com,CLOSED_WON\n';
      const { body, contentType } = makeMultipart('customers.csv', 'text/csv', csv);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/customers/import',
        headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
        body,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().created).toBe(1);
    });
  });
});
