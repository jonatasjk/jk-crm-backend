/**
 * HTTP-level integration tests using Fastify's inject.
 * Tests auth routes end-to-end through the full app.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { connectTestDB, disconnectTestDB, clearTestDB, createAdminUser } from '../helpers/db.js';
import { buildApp } from '../../src/app.js';
import { Invitation } from '../../src/models/Invitation.js';
import crypto from 'crypto';

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

  /** Helper: create admin user and return a JWT token via login */
  async function loginAsAdmin(email = 'admin@test.com', password = 'password123') {
    await createAdminUser(email, password, 'Admin');
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
    return res.json<{ token: string }>().token;
  }

  // ─── Login ─────────────────────────────────────────────────────────────────

  it('POST /auth/login returns token on valid credentials', async () => {
    await createAdminUser('login@test.com', 'mypassword', 'Login');
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'login@test.com', password: 'mypassword' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeDefined();
  });

  it('POST /auth/login returns mustChangePassword field', async () => {
    await createAdminUser('mcp@test.com', 'password123', 'MCP');
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'mcp@test.com', password: 'password123' } });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().user.mustChangePassword).toBe('boolean');
  });

  it('POST /auth/login returns 401 on bad password', async () => {
    await createAdminUser('login2@test.com', 'correctpw', 'L2');
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'login2@test.com', password: 'wrongpw' } });
    expect(res.statusCode).toBe(401);
  });

  // ─── Me ───────────────────────────────────────────────────────────────────

  it('GET /auth/me returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /auth/me returns user when authenticated', async () => {
    const token = await loginAsAdmin();
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toBeDefined();
  });

  // ─── Change password ───────────────────────────────────────────────────────

  it('POST /auth/change-password returns 200', async () => {
    const token = await loginAsAdmin('chpw@test.com', 'oldpassword');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: 'oldpassword', newPassword: 'newpassword1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });

  // ─── Forgot / reset password ───────────────────────────────────────────────

  it('POST /auth/forgot-password always returns 200', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'doesnotexist@test.com' },
    });
    expect(res.statusCode).toBe(200);
  });

  // ─── Invite ────────────────────────────────────────────────────────────────

  it('POST /auth/invite returns 201 when admin invites a new email', async () => {
    const token = await loginAsAdmin();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invite',
      headers: { authorization: `Bearer ${token}` },
      payload: { email: 'new@invited.com', role: 'MEMBER' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().message).toBeDefined();
  });

  it('POST /auth/invite returns 401 without token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invite',
      payload: { email: 'anon@test.com', role: 'MEMBER' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /auth/invite returns 409 when user already exists', async () => {
    const token = await loginAsAdmin();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invite',
      headers: { authorization: `Bearer ${token}` },
      payload: { email: 'admin@test.com', role: 'MEMBER' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('POST /auth/invite returns 422 on invalid body', async () => {
    const token = await loginAsAdmin();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/invite',
      headers: { authorization: `Bearer ${token}` },
      payload: { email: 'not-an-email', role: 'MEMBER' },
    });
    expect(res.statusCode).toBe(422);
  });

  // ─── Verify invite ─────────────────────────────────────────────────────────

  it('GET /auth/verify-invite returns email for valid token', async () => {
    const rawToken = 'test-verify-token';
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const { User } = await import('../../src/models/User.js');
    const admin = await User.findOne({ email: 'admin@test.com' }) ?? (await createAdminUser(), await User.findOne({ email: 'admin@test.com' }));
    await Invitation.create({
      email: 'toverify@test.com', tokenHash, invitedBy: admin!._id, role: 'MEMBER',
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });
    const res = await app.inject({ method: 'GET', url: `/api/v1/auth/verify-invite?token=${rawToken}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().email).toBe('toverify@test.com');
  });

  it('GET /auth/verify-invite returns 400 for invalid token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/verify-invite?token=bogus' });
    expect(res.statusCode).toBe(400);
  });

  // ─── Accept invite ─────────────────────────────────────────────────────────

  it('POST /auth/accept-invite creates user and returns token', async () => {
    const rawToken = 'accept-route-token';
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const { User } = await import('../../src/models/User.js');
    const admin = await User.findOne({ email: 'admin@test.com' }) ?? (await createAdminUser(), await User.findOne({ email: 'admin@test.com' }));
    await Invitation.create({
      email: 'toaccept@test.com', tokenHash, invitedBy: admin!._id, role: 'MEMBER',
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/accept-invite',
      payload: { token: rawToken, name: 'Accepted User', password: 'password123' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().token).toBeDefined();
  });

  it('POST /auth/accept-invite returns 400 for invalid token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/accept-invite',
      payload: { token: 'bogus', name: 'Ab', password: 'password123' },
    });
    expect(res.statusCode).toBe(400);
  });

  // ─── List users ────────────────────────────────────────────────────────────

  it('GET /users returns user list for admin', async () => {
    const token = await loginAsAdmin();
    const res = await app.inject({ method: 'GET', url: '/api/v1/users', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().users)).toBe(true);
    expect(res.json().users.length).toBeGreaterThan(0);
  });

  it('GET /users returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/users' });
    expect(res.statusCode).toBe(401);
  });

  // ─── Delete user ───────────────────────────────────────────────────────────

  it('DELETE /users/:id deletes another user', async () => {
    const token = await loginAsAdmin();
    // Create a second user to delete
    await createAdminUser('todelete@test.com', 'password123', 'ToDelete');
    const { User } = await import('../../src/models/User.js');
    const target = await User.findOne({ email: 'todelete@test.com' });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${String(target!._id)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);
  });

  it('DELETE /users/:id returns 400 when admin tries to delete themselves', async () => {
    const token = await loginAsAdmin();
    const { User } = await import('../../src/models/User.js');
    const self = await User.findOne({ email: 'admin@test.com' });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${String(self!._id)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('DELETE /users/:id returns 401 without token', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/users/000000000000000000000000' });
    expect(res.statusCode).toBe(401);
  });

  // ─── Health check ──────────────────────────────────────────────────────────

  it('GET /health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });
});
