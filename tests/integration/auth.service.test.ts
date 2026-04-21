import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB, createAdminUser } from '../helpers/db.js';
import {
  verifyCredentials,
  changePassword,
  inviteUser,
  verifyInviteToken,
  acceptInvite,
  generateResetToken,
  resetPasswordWithToken,
} from '../../src/services/auth.service.js';
import { User } from '../../src/models/User.js';
import { Invitation } from '../../src/models/Invitation.js';
import crypto from 'crypto';

// Mock Resend to avoid real network calls
vi.mock('../../src/config/aws.js', () => ({
  resend: {
    emails: {
      send: vi.fn().mockResolvedValue({ data: { id: 'mock-email-id' }, error: null }),
    },
  },
}));

describe('Auth service', () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  // ─── verifyCredentials ─────────────────────────────────────────────────────

  describe('verifyCredentials', () => {
    it('returns user data including mustChangePassword on valid credentials', async () => {
      await createAdminUser('login@test.com', 'mypassword', 'Login User');
      const result = await verifyCredentials({ email: 'login@test.com', password: 'mypassword' });
      expect(result.email).toBe('login@test.com');
      expect(result.name).toBe('Login User');
      expect(typeof result.mustChangePassword).toBe('boolean');
    });

    it('throws on unknown email', async () => {
      await expect(verifyCredentials({ email: 'unknown@test.com', password: 'x' })).rejects.toThrow(
        'Invalid credentials',
      );
    });

    it('throws on wrong password', async () => {
      await createAdminUser('wrong@test.com', 'correctpassword', 'Wrong');
      await expect(verifyCredentials({ email: 'wrong@test.com', password: 'badpassword' })).rejects.toThrow(
        'Invalid credentials',
      );
    });

    it('is case-insensitive for email', async () => {
      await createAdminUser('case@test.com', 'password1', 'Case');
      const result = await verifyCredentials({ email: 'CASE@TEST.COM', password: 'password1' });
      expect(result.email).toBe('case@test.com');
    });
  });

  // ─── changePassword ────────────────────────────────────────────────────────

  describe('changePassword', () => {
    it('updates password and clears mustChangePassword flag', async () => {
      const { email } = await createAdminUser('change@test.com', 'oldpassword', 'Change');
      // Set mustChangePassword to true so we can verify it gets cleared
      await User.findOneAndUpdate({ email }, { mustChangePassword: true });
      const user = await User.findOne({ email });
      await changePassword(String(user!._id), { currentPassword: 'oldpassword', newPassword: 'newpassword1' });
      const updated = await User.findOne({ email });
      expect(updated!.mustChangePassword).toBe(false);
      const result = await verifyCredentials({ email: 'change@test.com', password: 'newpassword1' });
      expect(result.email).toBe('change@test.com');
    });

    it('throws when current password is wrong', async () => {
      const { email } = await createAdminUser('chgwrong@test.com', 'correctpw', 'CHG');
      const user = await User.findOne({ email });
      await expect(changePassword(String(user!._id), { currentPassword: 'wrongpw', newPassword: 'newpassword1' })).rejects.toThrow(
        'Current password is incorrect',
      );
    });

    it('throws when user not found', async () => {
      await expect(
        changePassword('000000000000000000000000', { currentPassword: 'x', newPassword: 'newpassword1' }),
      ).rejects.toThrow('User not found');
    });
  });

  // ─── inviteUser ────────────────────────────────────────────────────────────

  describe('inviteUser', () => {
    it('creates an invitation and sends email', async () => {
      const { email: adminEmail } = await createAdminUser();
      const adminUser = await User.findOne({ email: adminEmail });
      await inviteUser({ email: 'invited@test.com', role: 'MEMBER' }, String(adminUser!._id));
      const invitation = await Invitation.findOne({ email: 'invited@test.com' });
      expect(invitation).not.toBeNull();
      expect(invitation!.tokenHash).toBeDefined();
    });

    it('throws when a user with that email already exists', async () => {
      const { email: adminEmail } = await createAdminUser();
      const adminUser = await User.findOne({ email: adminEmail });
      await expect(
        inviteUser({ email: adminEmail, role: 'MEMBER' }, String(adminUser!._id)),
      ).rejects.toThrow('A user with this email already exists');
    });

    it('invalidates previous pending invitations for the same email', async () => {
      const { email: adminEmail } = await createAdminUser();
      const adminUser = await User.findOne({ email: adminEmail });
      await inviteUser({ email: 'reinvite@test.com', role: 'MEMBER' }, String(adminUser!._id));
      await inviteUser({ email: 'reinvite@test.com', role: 'MEMBER' }, String(adminUser!._id));
      const count = await Invitation.countDocuments({ email: 'reinvite@test.com', acceptedAt: { $exists: false } });
      expect(count).toBe(1);
    });
  });

  // ─── verifyInviteToken ─────────────────────────────────────────────────────

  describe('verifyInviteToken', () => {
    it('returns email and role for a valid token', async () => {
      const rawToken = 'valid-token-abc';
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      await Invitation.create({
        email: 'verify@test.com',
        tokenHash,
        invitedBy: new mongoose.Types.ObjectId(),
        role: 'MEMBER',
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      });
      const result = await verifyInviteToken(rawToken);
      expect(result.email).toBe('verify@test.com');
      expect(result.role).toBe('MEMBER');
    });

    it('throws on invalid token', async () => {
      await expect(verifyInviteToken('nonexistent-token')).rejects.toThrow('Invalid or expired invitation');
    });

    it('throws on expired invitation', async () => {
      const rawToken = 'expired-invite-token';
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      await Invitation.create({
        email: 'expired-invite@test.com',
        tokenHash,
        invitedBy: new mongoose.Types.ObjectId(),
        role: 'MEMBER',
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(verifyInviteToken(rawToken)).rejects.toThrow('Invitation has expired');
    });
  });

  // ─── acceptInvite ──────────────────────────────────────────────────────────

  describe('acceptInvite', () => {
    it('creates a user from a valid invitation', async () => {
      const rawToken = 'accept-token-abc';
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      await Invitation.create({
        email: 'newuser@test.com',
        tokenHash,
        invitedBy: new mongoose.Types.ObjectId(),
        role: 'MEMBER',
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      });
      const result = await acceptInvite({ token: rawToken, name: 'New User', password: 'password123' });
      expect(result.email).toBe('newuser@test.com');
      expect(result.name).toBe('New User');
      expect(result.mustChangePassword).toBe(false);
      const user = await User.findOne({ email: 'newuser@test.com' });
      expect(user).not.toBeNull();
    });

    it('marks the invitation as accepted', async () => {
      const rawToken = 'accept-mark-token';
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      await Invitation.create({
        email: 'markaccepted@test.com',
        tokenHash,
        invitedBy: new mongoose.Types.ObjectId(),
        role: 'MEMBER',
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      });
      await acceptInvite({ token: rawToken, name: 'Mark', password: 'password123' });
      const inv = await Invitation.findOne({ tokenHash });
      expect(inv!.acceptedAt).toBeDefined();
    });

    it('throws on invalid token', async () => {
      await expect(acceptInvite({ token: 'bogus', name: 'X', password: 'password123' })).rejects.toThrow('Invalid or expired invitation');
    });

    it('throws on expired invitation', async () => {
      const rawToken = 'expired-accept-token';
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      await Invitation.create({
        email: 'expiredaccept@test.com',
        tokenHash,
        invitedBy: new mongoose.Types.ObjectId(),
        role: 'MEMBER',
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(acceptInvite({ token: rawToken, name: 'X', password: 'password123' })).rejects.toThrow('Invitation has expired');
    });
  });

  // ─── generateResetToken ────────────────────────────────────────────────────

  describe('generateResetToken', () => {
    it('sets reset token on user', async () => {
      await createAdminUser('reset@test.com', 'password1', 'Reset');
      await generateResetToken('reset@test.com');
      const user = await User.findOne({ email: 'reset@test.com' });
      expect(user?.passwordResetToken).toBeDefined();
      expect(user?.passwordResetExpires).toBeDefined();
      expect(user!.passwordResetExpires!.getTime()).toBeGreaterThan(Date.now());
    });

    it('returns silently when email is not registered', async () => {
      await expect(generateResetToken('notexists@test.com')).resolves.toBeUndefined();
    });
  });

  // ─── resetPasswordWithToken ────────────────────────────────────────────────

  describe('resetPasswordWithToken', () => {
    it('resets password with valid token', async () => {
      await createAdminUser('tok@test.com', 'oldpassword', 'Tok');
      const rawToken = 'known-raw-token-for-testing-only';
      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
      await User.findOneAndUpdate(
        { email: 'tok@test.com' },
        { passwordResetToken: hashedToken, passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000) },
      );
      await resetPasswordWithToken({ email: 'tok@test.com', token: rawToken, newPassword: 'brandnewpw1' });
      await expect(verifyCredentials({ email: 'tok@test.com', password: 'brandnewpw1' })).resolves.toBeTruthy();
    });

    it('throws on invalid token', async () => {
      await createAdminUser('bad-tok@test.com', 'oldpassword', 'Bad');
      const hashedToken = crypto.createHash('sha256').update('real-token').digest('hex');
      await User.findOneAndUpdate(
        { email: 'bad-tok@test.com' },
        { passwordResetToken: hashedToken, passwordResetExpires: new Date(Date.now() + 3600_000) },
      );
      await expect(
        resetPasswordWithToken({ email: 'bad-tok@test.com', token: 'wrong-token', newPassword: 'newpassword1' }),
      ).rejects.toThrow('Invalid or expired reset token');
    });

    it('throws on expired token', async () => {
      await createAdminUser('expired@test.com', 'oldpassword', 'Expired');
      const rawToken = 'expired-token';
      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
      await User.findOneAndUpdate(
        { email: 'expired@test.com' },
        { passwordResetToken: hashedToken, passwordResetExpires: new Date(Date.now() - 1000) },
      );
      await expect(
        resetPasswordWithToken({ email: 'expired@test.com', token: rawToken, newPassword: 'newpassword1' }),
      ).rejects.toThrow('Reset token has expired');
    });

    it('throws when user has no reset token', async () => {
      await createAdminUser('notok@test.com', 'oldpassword', 'NoTok');
      await expect(
        resetPasswordWithToken({ email: 'notok@test.com', token: 'sometoken', newPassword: 'newpassword1' }),
      ).rejects.toThrow('Invalid or expired reset token');
    });

    it('throws when email not found', async () => {
      await expect(
        resetPasswordWithToken({ email: 'nobody@test.com', token: 'x', newPassword: 'newpassword1' }),
      ).rejects.toThrow('Invalid or expired reset token');
    });
  });
});
