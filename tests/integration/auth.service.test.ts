import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import {
  registerUser,
  verifyCredentials,
  changePassword,
  generateResetToken,
  resetPasswordWithToken,
} from '../../src/services/auth.service.js';
import { User } from '../../src/models/User.js';

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

  // ─── registerUser ──────────────────────────────────────────────────────────

  describe('registerUser', () => {
    it('creates a new user and returns safe fields', async () => {
      const result = await registerUser({ email: 'alice@test.com', password: 'password123', name: 'Alice' });
      expect(result.email).toBe('alice@test.com');
      expect(result.name).toBe('Alice');
      expect(result.id).toBeDefined();
      expect((result as Record<string, unknown>)['passwordHash']).toBeUndefined();
    });

    it('throws when email already registered', async () => {
      await registerUser({ email: 'dup@test.com', password: 'password123', name: 'Dup' });
      await expect(registerUser({ email: 'dup@test.com', password: 'password123', name: 'Dup' })).rejects.toThrow(
        'Email already registered',
      );
    });

    it('is case-insensitive for email uniqueness', async () => {
      await registerUser({ email: 'upper@test.com', password: 'password123', name: 'Upper' });
      await expect(registerUser({ email: 'UPPER@test.com', password: 'password123', name: 'Upper2' })).rejects.toThrow(
        'Email already registered',
      );
    });
  });

  // ─── verifyCredentials ─────────────────────────────────────────────────────

  describe('verifyCredentials', () => {
    it('returns user data on valid credentials', async () => {
      await registerUser({ email: 'login@test.com', password: 'mypassword', name: 'Login User' });
      const result = await verifyCredentials({ email: 'login@test.com', password: 'mypassword' });
      expect(result.email).toBe('login@test.com');
      expect(result.name).toBe('Login User');
    });

    it('throws on unknown email', async () => {
      await expect(verifyCredentials({ email: 'unknown@test.com', password: 'x' })).rejects.toThrow(
        'Invalid credentials',
      );
    });

    it('throws on wrong password', async () => {
      await registerUser({ email: 'wrong@test.com', password: 'correctpassword', name: 'Wrong' });
      await expect(verifyCredentials({ email: 'wrong@test.com', password: 'badpassword' })).rejects.toThrow(
        'Invalid credentials',
      );
    });

    it('is case-insensitive for email', async () => {
      await registerUser({ email: 'case@test.com', password: 'password1', name: 'Case' });
      const result = await verifyCredentials({ email: 'CASE@TEST.COM', password: 'password1' });
      expect(result.email).toBe('case@test.com');
    });
  });

  // ─── changePassword ────────────────────────────────────────────────────────

  describe('changePassword', () => {
    it('updates password when current password is correct', async () => {
      const { id } = await registerUser({ email: 'change@test.com', password: 'oldpassword', name: 'Change' });
      await changePassword(String(id), { currentPassword: 'oldpassword', newPassword: 'newpassword1' });
      // Verify login works with new password
      const result = await verifyCredentials({ email: 'change@test.com', password: 'newpassword1' });
      expect(result.email).toBe('change@test.com');
    });

    it('throws when current password is wrong', async () => {
      const { id } = await registerUser({ email: 'chgwrong@test.com', password: 'correctpw', name: 'CHG' });
      await expect(changePassword(String(id), { currentPassword: 'wrongpw', newPassword: 'newpassword1' })).rejects.toThrow(
        'Current password is incorrect',
      );
    });

    it('throws when user not found', async () => {
      await expect(
        changePassword('000000000000000000000000', { currentPassword: 'x', newPassword: 'newpassword1' }),
      ).rejects.toThrow('User not found');
    });
  });

  // ─── generateResetToken ────────────────────────────────────────────────────

  describe('generateResetToken', () => {
    it('sets reset token on user', async () => {
      await registerUser({ email: 'reset@test.com', password: 'password1', name: 'Reset' });
      await generateResetToken('reset@test.com');
      const user = await User.findOne({ email: 'reset@test.com' });
      expect(user?.passwordResetToken).toBeDefined();
      expect(user?.passwordResetExpires).toBeDefined();
      expect(user!.passwordResetExpires!.getTime()).toBeGreaterThan(Date.now());
    });

    it('returns silently when email is not registered', async () => {
      // Should not throw
      await expect(generateResetToken('notexists@test.com')).resolves.toBeUndefined();
    });
  });

  // ─── resetPasswordWithToken ────────────────────────────────────────────────

  describe('resetPasswordWithToken', () => {
    it('resets password with valid token', async () => {
      const { resend: mockResend } = await import('../../src/config/aws.js');
      (mockResend.emails.send as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: { id: 'x' }, error: null });

      await registerUser({ email: 'tok@test.com', password: 'oldpassword', name: 'Tok' });

      // Manually inject a known raw token
      const rawToken = 'known-raw-token-for-testing-only';
      const hashedToken = (await import('crypto')).createHash('sha256').update(rawToken).digest('hex');
      await User.findOneAndUpdate(
        { email: 'tok@test.com' },
        {
          passwordResetToken: hashedToken,
          passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000),
        },
      );

      await resetPasswordWithToken({ email: 'tok@test.com', token: rawToken, newPassword: 'brandnewpw1' });
      await expect(verifyCredentials({ email: 'tok@test.com', password: 'brandnewpw1' })).resolves.toBeTruthy();
    });

    it('throws on invalid token', async () => {
      await registerUser({ email: 'bad-tok@test.com', password: 'oldpassword', name: 'Bad' });
      const hashedToken = (await import('crypto')).createHash('sha256').update('real-token').digest('hex');
      await User.findOneAndUpdate(
        { email: 'bad-tok@test.com' },
        { passwordResetToken: hashedToken, passwordResetExpires: new Date(Date.now() + 3600_000) },
      );
      await expect(
        resetPasswordWithToken({ email: 'bad-tok@test.com', token: 'wrong-token', newPassword: 'newpassword1' }),
      ).rejects.toThrow('Invalid or expired reset token');
    });

    it('throws on expired token', async () => {
      await registerUser({ email: 'expired@test.com', password: 'oldpassword', name: 'Expired' });
      const rawToken = 'expired-token';
      const hashedToken = (await import('crypto')).createHash('sha256').update(rawToken).digest('hex');
      await User.findOneAndUpdate(
        { email: 'expired@test.com' },
        {
          passwordResetToken: hashedToken,
          passwordResetExpires: new Date(Date.now() - 1000), // already expired
        },
      );
      await expect(
        resetPasswordWithToken({ email: 'expired@test.com', token: rawToken, newPassword: 'newpassword1' }),
      ).rejects.toThrow('Reset token has expired');
    });

    it('throws when user has no reset token', async () => {
      await registerUser({ email: 'notok@test.com', password: 'oldpassword', name: 'NoTok' });
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
