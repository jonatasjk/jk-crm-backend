import type { FastifyRequest, FastifyReply } from 'fastify';
import { sendEmailSchema } from '../schemas/email.schema.js';
import { sendEmail, getEmailLogs, listAllEmailLogs, getEmailStats } from '../services/email.service.js';
import { EntityType } from '../types/enums.js';
import { z } from 'zod';

export async function send(req: FastifyRequest, reply: FastifyReply) {
  const body = sendEmailSchema.parse(req.body);
  const result = await sendEmail(body);
  return reply.send(result);
}

export async function logs(
  req: FastifyRequest<{ Params: { entityType: string; entityId: string } }>,
  reply: FastifyReply,
) {
  const { entityId, entityType } = req.params;
  const parsedType = z.nativeEnum(EntityType).parse(entityType.toUpperCase());
  const result = await getEmailLogs(entityId, parsedType);
  return reply.send(result);
}

export async function listAll(req: FastifyRequest, reply: FastifyReply) {
  const result = await listAllEmailLogs();
  return reply.send(result);
}

export async function stats(req: FastifyRequest, reply: FastifyReply) {
  const result = await getEmailStats();
  return reply.send(result);
}
