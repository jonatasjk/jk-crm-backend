/**
 * HTTP-level integration tests using Fastify's inject.
 * Tests auth routes end-to-end through the full app.
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

describe('Auth routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await connectTestDB();
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  async function registerAndLogin(email = 'auth@test.com', password = 'password123', name = 'Auth User') {
    await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email, password, name } });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    return res.json<{ token: string }>().token;
  }

  it('POST /auth/register returns 201 with token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'new@test.com', password: 'password123', name: 'New User' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().token).toBeDefined();
  });

  it('POST /auth/register returns 409 on duplicate email', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'dup@test.com', password: 'password123', name: 'Dup' } });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'dup@test.com', password: 'password123', name: 'Dup2' } });
    expect(res.statusCode).toBe(409);
  });

  it('POST /auth/register returns 422 on invalid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'not-an-email', password: 'pw', name: 'X' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('POST /auth/login returns token on valid credentials', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'login@test.com', password: 'mypassword', name: 'Login' } });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'login@test.com', password: 'mypassword' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeDefined();
  });

  it('POST /auth/login returns 401 on bad password', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { email: 'login2@test.com', password: 'correctpw', name: 'L2' } });
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'login2@test.com', password: 'wrongpw' } });
    expect(res.statusCode).toBe(401);
  });

  it('GET /auth/me returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /auth/me returns user when authenticated', async () => {
    const token = await registerAndLogin();
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toBeDefined();
  });

  it('POST /auth/change-password returns 200', async () => {
    const token = await registerAndLogin('chpw@test.com', 'oldpassword');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: 'oldpassword', newPassword: 'newpassword1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });

  it('POST /auth/forgot-password always returns 200', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'doesnotexist@test.com' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET /health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });
});
