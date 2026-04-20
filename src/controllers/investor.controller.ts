import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  createInvestorSchema,
  updateInvestorSchema,
  listInvestorsSchema,
} from '../schemas/investor.schema.js';
import {
  listInvestors,
  getInvestorById,
  createInvestor,
  updateInvestor,
  deleteInvestor,
  importInvestors,
} from '../services/investor.service.js';
import { parseInvestorCsv } from '../services/csv.service.js';
import { createInvestorSchema as investorRowSchema } from '../schemas/investor.schema.js';

export async function list(req: FastifyRequest, reply: FastifyReply) {
  const query = listInvestorsSchema.parse(req.query);
  const result = await listInvestors(query);
  return reply.send(result);
}

export async function getOne(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const investor = await getInvestorById(req.params.id);
  if (!investor) return reply.code(404).send({ error: 'Not found' });
  return reply.send(investor);
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const body = createInvestorSchema.parse(req.body);
  const investor = await createInvestor(body);
  return reply.code(201).send(investor);
}

export async function update(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const body = updateInvestorSchema.parse(req.body);
  const investor = await updateInvestor(req.params.id, body);
  return reply.send(investor);
}

export async function remove(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  await deleteInvestor(req.params.id);
  return reply.code(204).send();
}

export async function importCsv(req: FastifyRequest, reply: FastifyReply) {
  const data = await req.file();
  if (!data) return reply.code(400).send({ error: 'No file uploaded' });

  const buffer = await data.toBuffer();

  let rawRows: ReturnType<typeof parseInvestorCsv>;
  const parseErrors: { row: number; error: string }[] = [];

  try {
    rawRows = parseInvestorCsv(buffer);
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
    const parsed = investorRowSchema.safeParse(rawRows[i]);
    if (parsed.success) {
      validRows.push(parsed.data);
    } else {
      parseErrors.push({ row: i + 1, error: JSON.stringify(parsed.error.flatten().fieldErrors) });
    }
  }

  const importResult = await importInvestors(validRows);
  return reply.send({
    ...importResult,
    parseErrors,
    total: rawRows.length,
  });
}
