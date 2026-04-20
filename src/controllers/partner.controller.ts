import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  createPartnerSchema,
  updatePartnerSchema,
  listPartnersSchema,
} from '../schemas/partner.schema.js';
import {
  listPartners,
  getPartnerById,
  createPartner,
  updatePartner,
  deletePartner,
  importPartners,
} from '../services/partner.service.js';
import { parsePartnerCsv } from '../services/csv.service.js';
import { createPartnerSchema as partnerRowSchema } from '../schemas/partner.schema.js';

export async function list(req: FastifyRequest, reply: FastifyReply) {
  const query = listPartnersSchema.parse(req.query);
  const result = await listPartners(query);
  return reply.send(result);
}

export async function getOne(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const partner = await getPartnerById(req.params.id);
  if (!partner) return reply.code(404).send({ error: 'Not found' });
  return reply.send(partner);
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const body = createPartnerSchema.parse(req.body);
  const partner = await createPartner(body);
  return reply.code(201).send(partner);
}

export async function update(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const body = updatePartnerSchema.parse(req.body);
  const partner = await updatePartner(req.params.id, body);
  return reply.send(partner);
}

export async function remove(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  await deletePartner(req.params.id);
  return reply.code(204).send();
}

export async function importCsv(req: FastifyRequest, reply: FastifyReply) {
  const data = await req.file();
  if (!data) return reply.code(400).send({ error: 'No file uploaded' });

  const buffer = await data.toBuffer();

  let rawRows: ReturnType<typeof parsePartnerCsv>;
  const parseErrors: { row: number; error: string }[] = [];

  try {
    rawRows = parsePartnerCsv(buffer);
  } catch (e: unknown) {
    const err = e as { code?: string; lines?: number; message: string };
    if (err.code === 'CSV_RECORD_INCONSISTENT_COLUMNS') {
      const row = err.lines ?? '?';
      return reply.code(422).send({
        created: 0, updated: 0, errors: [],
        parseErrors: [{ row, error: `Row ${row} has the wrong number of columns. Make sure every column has a value — use an empty field (e.g. two consecutive commas) for fields you want to leave blank.` }],
        total: 0,
      });
    }
    throw e;
  }

  const validRows = [];

  for (let i = 0; i < rawRows.length; i++) {
    const parsed = partnerRowSchema.safeParse(rawRows[i]);
    if (parsed.success) {
      validRows.push(parsed.data);
    } else {
      parseErrors.push({ row: i + 1, error: JSON.stringify(parsed.error.flatten().fieldErrors) });
    }
  }

  const importResult = await importPartners(validRows);
  return reply.send({
    ...importResult,
    parseErrors,
    total: rawRows.length,
  });
}
