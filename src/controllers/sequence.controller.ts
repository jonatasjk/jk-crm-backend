import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Types } from 'mongoose';
import { EntityType } from '../types/enums.js';
import {
  listSequences,
  getSequenceById,
  createSequence,
  updateSequence,
  deleteSequence,
  enrollEntity,
  unenrollEntity,
  markReplied,
  listEnrollments,
  enrollAll as enrollAllService,
} from '../services/sequence.service.js';

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  entityType: z.nativeEnum(EntityType),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED']).optional(),
  scheduledStartAt: z.string().datetime().optional(),
  steps: z
    .array(
      z.object({
        order: z.number().int().positive(),
        subject: z.string().min(1),
        bodyHtml: z.string().min(1),
        delayDays: z.number().int().min(0),
        materialId: z.string().optional(),
      }),
    )
    .optional(),
});

const enrollSchema = z.object({
  entityId: z.string().min(1),
});

export async function list(_req: FastifyRequest, reply: FastifyReply) {
  return reply.send(await listSequences());
}

export async function getOne(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const seq = await getSequenceById(req.params.id);
  if (!seq) return reply.code(404).send({ error: 'Not found' });
  return reply.send(seq);
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const body = createSchema.parse(req.body);
  return reply.code(201).send(await createSequence(body));
}

export async function update(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const raw = updateSchema.parse(req.body);
  const body = {
    ...raw,
    scheduledStartAt: raw.scheduledStartAt ? new Date(raw.scheduledStartAt) : undefined,
    steps: raw.steps?.map((s) => ({
      ...s,
      materialId: s.materialId ? new Types.ObjectId(s.materialId) : undefined,
    })),
  };
  return reply.send(await updateSequence(req.params.id, body));
}

export async function remove(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  await deleteSequence(req.params.id);
  return reply.code(204).send();
}

export async function enroll(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const { entityId } = enrollSchema.parse(req.body);
  return reply.code(201).send(await enrollEntity(req.params.id, entityId));
}

export async function unenroll(
  req: FastifyRequest<{ Params: { enrollmentId: string } }>,
  reply: FastifyReply,
) {
  return reply.send(await unenrollEntity(req.params.enrollmentId));
}

export async function replied(
  req: FastifyRequest<{ Params: { enrollmentId: string } }>,
  reply: FastifyReply,
) {
  return reply.send(await markReplied(req.params.enrollmentId));
}

export async function enrollments(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  return reply.send(await listEnrollments(req.params.id));
}

export async function enrollAll(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  return reply.code(201).send(await enrollAllService(req.params.id));
}
