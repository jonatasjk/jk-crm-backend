import type { FastifyRequest, FastifyReply } from 'fastify';
import { loginSchema, changePasswordSchema, forgotPasswordSchema, resetPasswordSchema, inviteSchema, acceptInviteSchema } from '../schemas/auth.schema.js';
import { verifyCredentials, changePassword, generateResetToken, resetPasswordWithToken, inviteUser, verifyInviteToken, acceptInvite } from '../services/auth.service.js';
import { User } from '../models/User.js';

export async function login(req: FastifyRequest, reply: FastifyReply) {
  const body = loginSchema.parse(req.body);
  const user = await verifyCredentials(body);
  const token = req.server.jwt.sign({ id: user.id, email: user.email, role: user.role });
  return reply.send({ user, token });
}

export async function me(req: FastifyRequest, reply: FastifyReply) {
  await req.jwtVerify();
  return reply.send({ user: req.user });
}

export async function changePasswordHandler(req: FastifyRequest, reply: FastifyReply) {
  const user = req.user as { id: string };
  const body = changePasswordSchema.parse(req.body);
  await changePassword(user.id, body);
  return reply.send({ success: true });
}

export async function forgotPassword(req: FastifyRequest, reply: FastifyReply) {
  const body = forgotPasswordSchema.parse(req.body);
  await generateResetToken(body.email);
  return reply.send({ message: 'If that email is registered, a reset link has been sent.' });
}

export async function resetPassword(req: FastifyRequest, reply: FastifyReply) {
  const body = resetPasswordSchema.parse(req.body);
  await resetPasswordWithToken(body);
  return reply.send({ success: true });
}

export async function invite(req: FastifyRequest, reply: FastifyReply) {
  const actor = req.user as { id: string; role: string };
  const body = inviteSchema.parse(req.body);
  await inviteUser(body, actor.id);
  return reply.code(201).send({ message: `Invitation sent to ${body.email}` });
}

export async function verifyInvite(req: FastifyRequest<{ Querystring: { token?: string } }>, reply: FastifyReply) {
  const { token } = req.query;
  if (!token) return reply.code(400).send({ error: 'Token is required' });
  const data = await verifyInviteToken(token);
  return reply.send(data);
}

export async function acceptInviteHandler(req: FastifyRequest, reply: FastifyReply) {
  const body = acceptInviteSchema.parse(req.body);
  const user = await acceptInvite(body);
  const token = req.server.jwt.sign({ id: user.id, email: user.email, role: user.role });
  return reply.code(201).send({ user, token });
}

export async function listUsers(req: FastifyRequest, reply: FastifyReply) {
  const users = await User.find().select('-passwordHash -passwordResetToken -passwordResetExpires').sort({ createdAt: -1 }).lean();
  return reply.send({ users: users.map((u) => ({ ...u, id: String(u._id), _id: undefined, __v: undefined })) });
}

export async function deleteUser(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const actor = req.user as { id: string };
  if (actor.id === req.params.id) {
    return reply.code(400).send({ error: 'You cannot delete your own account' });
  }
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) return reply.code(404).send({ error: 'User not found' });
  return reply.code(204).send();
}
