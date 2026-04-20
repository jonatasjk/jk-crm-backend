import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { User } from '../models/User.js';
import { resend } from '../config/aws.js';
import { env } from '../config/env.js';
import type { RegisterInput, LoginInput, ChangePasswordInput, ResetPasswordInput } from '../schemas/auth.schema.js';

const SALT_ROUNDS = 12;

export async function registerUser(input: RegisterInput) {
  const existing = await User.findOne({ email: input.email.toLowerCase() });
  if (existing) {
    throw new Error('Email already registered');
  }
  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const user = await User.create({ email: input.email, name: input.name, passwordHash });
  return { id: user._id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt };
}

export async function verifyCredentials(input: LoginInput) {
  const user = await User.findOne({ email: input.email.toLowerCase() });
  if (!user) throw new Error('Invalid credentials');
  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) throw new Error('Invalid credentials');
  return { id: user._id, email: user.email, name: user.name, role: user.role };
}

export async function changePassword(userId: string, input: ChangePasswordInput) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  const valid = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!valid) throw new Error('Current password is incorrect');
  user.passwordHash = await bcrypt.hash(input.newPassword, SALT_ROUNDS);
  await user.save();
}

export async function generateResetToken(email: string) {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) return; // silently return — don't reveal whether email exists

  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

  user.passwordResetToken = hashedToken;
  user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await user.save();

  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${rawToken}&email=${encodeURIComponent(email)}`;
  await resend.emails.send({
    from: `${env.FROM_NAME} <${env.FROM_EMAIL}>`,
    to: email,
    subject: 'Password Reset',
    html: `<p>You requested a password reset.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in 1 hour. If you did not request this, ignore this email.</p>`,
  });
}

export async function resetPasswordWithToken(input: ResetPasswordInput) {
  const user = await User.findOne({ email: input.email.toLowerCase() });
  if (!user || !user.passwordResetToken || !user.passwordResetExpires) {
    throw new Error('Invalid or expired reset token');
  }
  if (user.passwordResetExpires < new Date()) {
    throw new Error('Reset token has expired');
  }
  const hashedToken = crypto.createHash('sha256').update(input.token).digest('hex');
  if (hashedToken !== user.passwordResetToken) {
    throw new Error('Invalid or expired reset token');
  }
  user.passwordHash = await bcrypt.hash(input.newPassword, SALT_ROUNDS);
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();
}

