import type { FastifyRequest, FastifyReply } from 'fastify';
import { Role } from '../types/enums.js';

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const user = req.user as { role?: string } | undefined;
  if (!user || user.role !== Role.ADMIN) {
    return reply.code(403).send({ error: 'Forbidden' });
  }
}
