import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { User } from '../models/User.js';
import { Invitation } from '../models/Invitation.js';
import { resend } from '../config/aws.js';
import { env } from '../config/env.js';
import type { LoginInput, ChangePasswordInput, ResetPasswordInput, InviteInput, AcceptInviteInput } from '../schemas/auth.schema.js';

const SALT_ROUNDS = 12;

export async function verifyCredentials(input: LoginInput) {
  const user = await User.findOne({ email: input.email.toLowerCase() });
  if (!user) throw new Error('Invalid credentials');
  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) throw new Error('Invalid credentials');
  return { id: user._id, email: user.email, name: user.name, role: user.role, mustChangePassword: user.mustChangePassword };
}

export async function changePassword(userId: string, input: ChangePasswordInput) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  const valid = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!valid) throw new Error('Current password is incorrect');
  user.passwordHash = await bcrypt.hash(input.newPassword, SALT_ROUNDS);
  user.mustChangePassword = false;
  await user.save();
}

export async function inviteUser(input: InviteInput, invitedById: string) {
  const existing = await User.findOne({ email: input.email.toLowerCase() });
  if (existing) throw new Error('A user with this email already exists');

  // Invalidate any existing pending invitation for this email
  await Invitation.deleteMany({ email: input.email.toLowerCase(), acceptedAt: { $exists: false } });

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  await Invitation.create({
    email: input.email.toLowerCase(),
    tokenHash,
    invitedBy: invitedById,
    role: input.role,
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours
  });

  const inviteUrl = `${env.FRONTEND_URL}/accept-invite?token=${rawToken}`;
  await resend.emails.send({
    from: `${env.FROM_NAME} <${env.FROM_EMAIL}>`,
    to: input.email,
    subject: "You've been invited to JK CRM",
    html: `<p>You have been invited to join JK CRM.</p><p><a href="${inviteUrl}">Accept your invitation</a></p><p>This link expires in 48 hours.</p>`,
  });
}

export async function verifyInviteToken(rawToken: string) {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const invitation = await Invitation.findOne({ tokenHash, acceptedAt: { $exists: false } });
  if (!invitation) throw new Error('Invalid or expired invitation');
  if (invitation.expiresAt < new Date()) throw new Error('Invitation has expired');
  return { email: invitation.email, role: invitation.role };
}

export async function acceptInvite(input: AcceptInviteInput) {
  const tokenHash = crypto.createHash('sha256').update(input.token).digest('hex');
  const invitation = await Invitation.findOne({ tokenHash, acceptedAt: { $exists: false } });
  if (!invitation) throw new Error('Invalid or expired invitation');
  if (invitation.expiresAt < new Date()) throw new Error('Invitation has expired');

  const existing = await User.findOne({ email: invitation.email });
  if (existing) throw new Error('A user with this email already exists');

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const user = await User.create({
    email: invitation.email,
    name: input.name,
    passwordHash,
    role: invitation.role,
    mustChangePassword: false,
  });

  invitation.acceptedAt = new Date();
  await invitation.save();

  return { id: user._id, email: user.email, name: user.name, role: user.role, mustChangePassword: false };
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

