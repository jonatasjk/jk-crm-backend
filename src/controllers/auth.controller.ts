import type { FastifyRequest, FastifyReply } from 'fastify';
import { registerSchema, loginSchema, changePasswordSchema, forgotPasswordSchema, resetPasswordSchema } from '../schemas/auth.schema.js';
import { registerUser, verifyCredentials, changePassword, generateResetToken, resetPasswordWithToken } from '../services/auth.service.js';

export async function register(req: FastifyRequest, reply: FastifyReply) {
  const body = registerSchema.parse(req.body);
  const user = await registerUser(body);
  const token = req.server.jwt.sign({ id: user.id, email: user.email, role: user.role });
  return reply.code(201).send({ user, token });
}

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
  // Always 200 to avoid revealing whether the email exists
  return reply.send({ message: 'If that email is registered, a reset link has been sent.' });
}

export async function resetPassword(req: FastifyRequest, reply: FastifyReply) {
  const body = resetPasswordSchema.parse(req.body);
  await resetPasswordWithToken(body);
  return reply.send({ success: true });
}
