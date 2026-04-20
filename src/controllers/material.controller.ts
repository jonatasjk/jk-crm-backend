import type { FastifyRequest, FastifyReply } from 'fastify';
import { uploadMaterial, listMaterials, getMaterialForDownload, deleteMaterial } from '../services/material.service.js';
import { EntityType } from '../types/enums.js';
import { z } from 'zod';

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'text/plain',
]);

export async function upload(req: FastifyRequest, reply: FastifyReply) {
  const data = await req.file();
  if (!data) return reply.code(400).send({ error: 'No file provided' });

  const mimeType = data.mimetype;
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return reply.code(415).send({ error: 'Unsupported file type' });
  }

  const buffer = await data.toBuffer();
  const entityTypeRaw = (req.query as Record<string, string>)['entityType'];
  const entityType = z.nativeEnum(EntityType).parse(entityTypeRaw?.toUpperCase() ?? 'INVESTOR');
  const description = (req.query as Record<string, string>)['description'];

  const material = await uploadMaterial(
    buffer,
    data.filename,
    mimeType,
    buffer.length,
    entityType,
    description,
  );

  return reply.code(201).send(material);
}

export async function list(req: FastifyRequest, reply: FastifyReply) {
  const entityTypeRaw = (req.query as Record<string, string>)['entityType'];
  const entityType = entityTypeRaw
    ? z.nativeEnum(EntityType).parse(entityTypeRaw.toUpperCase())
    : undefined;
  const materials = await listMaterials(entityType);
  return reply.send(materials);
}

export async function download(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  const { material, buffer } = await getMaterialForDownload(req.params.id);
  return reply
    .header('Content-Type', material.mimeType)
    .header('Content-Disposition', `attachment; filename="${material.name}"`)
    .header('Content-Length', buffer.length)
    .send(buffer);
}

export async function remove(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
) {
  await deleteMaterial(req.params.id);
  return reply.code(204).send();
}
