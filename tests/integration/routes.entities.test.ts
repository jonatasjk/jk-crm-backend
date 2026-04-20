/**
 * HTTP-level integration tests for investor and partner routes.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { buildApp } from '../../src/app.js';

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
    payload: { email: 'admin@test.com', password: 'password123', name: 'Admin' },
  });
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'admin@test.com', password: 'password123' },
  });
  return res.json<{ token: string }>().token;
}

// ─── Investor routes ──────────────────────────────────────────────────────────

describe('Investor routes', () => {
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
    // Only clear non-user collections to keep token valid
    const mongoose = await import('mongoose');
    const collections = mongoose.default.connection.collections;
    for (const key of Object.keys(collections)) {
      if (key !== 'users') await collections[key]!.deleteMany({});
    }
  });

  const investorPayload = { firstName: 'Alice', lastName: 'Smith', email: 'alice@test.com' };

  it('GET /investors returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/investors' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /investors creates investor', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/investors',
      headers: { authorization: `Bearer ${token}` },
      payload: investorPayload,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().email).toBe('alice@test.com');
  });

  it('GET /investors returns paginated list', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/investors', headers: { authorization: `Bearer ${token}` }, payload: investorPayload });
    const res = await app.inject({ method: 'GET', url: '/api/v1/investors', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(1);
  });

  it('GET /investors/:id returns investor', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/investors', headers: { authorization: `Bearer ${token}` }, payload: investorPayload });
    const id = created.json().id;
    const res = await app.inject({ method: 'GET', url: `/api/v1/investors/${id}`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().email).toBe('alice@test.com');
  });

  it('GET /investors/:id returns 404 for unknown id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/investors/000000000000000000000000', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(404);
  });

  it('PUT /investors/:id updates investor', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/investors', headers: { authorization: `Bearer ${token}` }, payload: investorPayload });
    const id = created.json().id;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/investors/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { company: 'Acme Corp' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().company).toBe('Acme Corp');
  });

  it('DELETE /investors/:id removes investor', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/investors', headers: { authorization: `Bearer ${token}` }, payload: investorPayload });
    const id = created.json().id;
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/investors/${id}`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(204);
  });

  it('GET /investors supports search query', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/investors', headers: { authorization: `Bearer ${token}` }, payload: investorPayload });
    const res = await app.inject({ method: 'GET', url: '/api/v1/investors?search=Alice', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(1);
  });
});

// ─── Partner routes ───────────────────────────────────────────────────────────

describe('Partner routes', () => {
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

  const partnerPayload = { firstName: 'Bob', lastName: 'Jones', email: 'bob@partner.com' };

  it('POST /partners creates partner', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/partners',
      headers: { authorization: `Bearer ${token}` },
      payload: partnerPayload,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().email).toBe('bob@partner.com');
  });

  it('GET /partners returns list', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/partners', headers: { authorization: `Bearer ${token}` }, payload: partnerPayload });
    const res = await app.inject({ method: 'GET', url: '/api/v1/partners', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(1);
  });

  it('GET /partners/:id returns 404 for unknown id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/partners/000000000000000000000000', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /partners/:id removes partner', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/partners', headers: { authorization: `Bearer ${token}` }, payload: partnerPayload });
    const id = created.json().id;
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/partners/${id}`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(204);
  });

  it('PUT /partners/:id updates partner', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/partners', headers: { authorization: `Bearer ${token}` }, payload: partnerPayload });
    const id = created.json().id;
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/partners/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { company: 'NewCo' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().company).toBe('NewCo');
  });
});
