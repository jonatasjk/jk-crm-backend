import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  createCustomerSchema,
  updateCustomerSchema,
  listCustomersSchema,
} from '../schemas/customer.schema.js';
import {
  listCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  importCustomers,
} from '../services/customer.service.js';
import { parseCustomerCsv } from '../services/csv.service.js';
import { createCustomerSchema as customerRowSchema } from '../schemas/customer.schema.js';

export async function list(req: FastifyRequest, reply: FastifyReply) {
  const query = listCustomersSchema.parse(req.query);
  const result = await listCustomers(query);
  return reply.send(result);
}

export async function getOne(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const customer = await getCustomerById(req.params.id);
  if (!customer) return reply.code(404).send({ error: 'Not found' });
  return reply.send(customer);
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const body = createCustomerSchema.parse(req.body);
  const customer = await createCustomer(body);
  return reply.code(201).send(customer);
}

export async function update(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const body = updateCustomerSchema.parse(req.body);
  const customer = await updateCustomer(req.params.id, body);
  return reply.send(customer);
}

export async function remove(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  await deleteCustomer(req.params.id);
  return reply.code(204).send();
}

export async function importCsv(req: FastifyRequest, reply: FastifyReply) {
  const data = await req.file();
  if (!data) return reply.code(400).send({ error: 'No file uploaded' });

  const buffer = await data.toBuffer();

  let rawRows: ReturnType<typeof parseCustomerCsv>;
  const parseErrors: { row: number; error: string }[] = [];

  try {
    rawRows = parseCustomerCsv(buffer);
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
    const parsed = customerRowSchema.safeParse(rawRows[i]);
    if (parsed.success) {
      validRows.push(parsed.data);
    } else {
      parseErrors.push({ row: i + 1, error: JSON.stringify(parsed.error.flatten().fieldErrors) });
    }
  }

  const importResult = await importCustomers(validRows);
  return reply.send({
    ...importResult,
    parseErrors,
    total: rawRows.length,
  });
}
