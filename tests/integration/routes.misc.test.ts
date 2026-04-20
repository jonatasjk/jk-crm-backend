/**
 * HTTP-level integration tests for emoji, sequence, and material routes.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { rm } from 'fs/promises';
import { join } from 'path';
import type { FastifyInstance } from 'fastify';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { buildApp } from '../../src/app.js';
import { Sequence } from '../../src/models/Sequence.js';

vi.mock('../../src/config/aws.js', () => ({
  resend: {
    emails: {
      send: vi.fn().mockResolvedValue({ data: { id: 'mock-id' }, error: null }),
    },
  },
}));

async function getAuthToken(app: FastifyInstance): Promise<string> {
  await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email: 'admin@routes.com', password: 'password123', name: 'Admin' },
  });
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'admin@routes.com', password: 'password123' },
  });
  return res.json<{ token: string }>().token;
}

// ─── Sequence routes ──────────────────────────────────────────────────────────

describe('Sequence routes', () => {
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

  it('POST /sequences creates sequence', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sequences',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Test Sequence', entityType: 'INVESTOR' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe('Test Sequence');
  });

  it('GET /sequences lists sequences', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/sequences', headers: { authorization: `Bearer ${token}` }, payload: { name: 'S1', entityType: 'INVESTOR' } });
    const res = await app.inject({ method: 'GET', url: '/api/v1/sequences', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('GET /sequences/:id returns sequence', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/sequences', headers: { authorization: `Bearer ${token}` }, payload: { name: 'S2', entityType: 'INVESTOR' } });
    const id = created.json().id;
    const res = await app.inject({ method: 'GET', url: `/api/v1/sequences/${id}`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(id);
  });

  it('GET /sequences/:id returns 404 for unknown id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/sequences/000000000000000000000000', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(404);
  });

  it('PUT /sequences/:id updates sequence', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/sequences', headers: { authorization: `Bearer ${token}` }, payload: { name: 'Old', entityType: 'INVESTOR' } });
    const id = created.json().id;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/sequences/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Updated' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Updated');
  });

  it('DELETE /sequences/:id removes sequence', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/sequences', headers: { authorization: `Bearer ${token}` }, payload: { name: 'Del', entityType: 'INVESTOR' } });
    const id = created.json().id;
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/sequences/${id}`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(204);
  });

  it('POST /sequences/:id/enroll enrolls an investor', async () => {
    // Create sequence with a step
    const created = await app.inject({ method: 'POST', url: '/api/v1/sequences', headers: { authorization: `Bearer ${token}` }, payload: { name: 'Enroll', entityType: 'INVESTOR' } });
    const seqId = created.json().id;
    await Sequence.findByIdAndUpdate(seqId, { steps: [{ order: 1, subject: 'Hi', bodyHtml: '<p>Hi</p>', delayDays: 0 }] });

    // Create investor
    const invRes = await app.inject({ method: 'POST', url: '/api/v1/investors', headers: { authorization: `Bearer ${token}` }, payload: { firstName: 'Inv', lastName: 'Test', email: 'inv@seq.com' } });
    const invId = invRes.json().id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/sequences/${seqId}/enroll`,
      headers: { authorization: `Bearer ${token}` },
      payload: { entityId: invId },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('ACTIVE');
  });

  it('GET /sequences/:id/enrollments lists enrollments', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/sequences', headers: { authorization: `Bearer ${token}` }, payload: { name: 'ListEnr', entityType: 'INVESTOR' } });
    const seqId = created.json().id;
    const res = await app.inject({ method: 'GET', url: `/api/v1/sequences/${seqId}/enrollments`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

// ─── Email routes ─────────────────────────────────────────────────────────────

describe('Email routes', () => {
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

  it('GET /email/stats returns sentToday', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/email/stats', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().sentToday).toBe('number');
  });

  it('GET /email/logs returns all logs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/email/logs', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('GET /email/logs/:entityType/:entityId returns logs', async () => {
    const invRes = await app.inject({ method: 'POST', url: '/api/v1/investors', headers: { authorization: `Bearer ${token}` }, payload: { firstName: 'Log', lastName: 'Test', email: 'log@test.com' } });
    const invId = invRes.json().id;
    const res = await app.inject({ method: 'GET', url: `/api/v1/email/logs/investor/${invId}`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it('POST /email/send sends email to investor', async () => {
    const invRes = await app.inject({ method: 'POST', url: '/api/v1/investors', headers: { authorization: `Bearer ${token}` }, payload: { firstName: 'Send', lastName: 'Test', email: 'send@test.com' } });
    const invId = invRes.json().id;
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/email/send',
      headers: { authorization: `Bearer ${token}` },
      payload: { entityId: invId, entityType: 'INVESTOR', subject: 'Hi', body: '<p>Hello</p>' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });
});

// ─── Material routes ──────────────────────────────────────────────────────────

describe('Material routes', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    await connectTestDB();
    app = await buildApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
    await rm(join(process.cwd(), 'uploads-test'), { recursive: true, force: true });
    await disconnectTestDB();
  });

  beforeEach(async () => {
    const mongoose = await import('mongoose');
    const collections = mongoose.default.connection.collections;
    for (const key of Object.keys(collections)) {
      if (key !== 'users') await collections[key]!.deleteMany({});
    }
  });

  it('POST /materials/upload returns 201 with file', async () => {
    const body = Buffer.from(
      '--boundary\r\nContent-Disposition: form-data; name="file"; filename="test.pdf"\r\nContent-Type: application/pdf\r\n\r\nPDF Content\r\n--boundary--',
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/materials/upload?entityType=investor',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'multipart/form-data; boundary=boundary',
      },
      body,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().mimeType).toBe('application/pdf');
  });

  it('POST /materials/upload returns 415 for unsupported MIME type', async () => {
    const body = Buffer.from(
      '--boundary\r\nContent-Disposition: form-data; name="file"; filename="test.exe"\r\nContent-Type: application/octet-stream\r\n\r\nBINARY\r\n--boundary--',
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/materials/upload?entityType=investor',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'multipart/form-data; boundary=boundary',
      },
      body,
    });
    expect(res.statusCode).toBe(415);
  });

  it('GET /materials returns list', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/materials', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});
