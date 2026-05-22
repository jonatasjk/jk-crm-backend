import { z } from 'zod';
import { CustomerStage } from '../types/enums.js';

const stageField = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.nativeEnum(CustomerStage).optional(),
);

export const createCustomerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  company: z.string().optional(),
  website: z.string().optional().or(z.literal('')),
  linkedinUrl: z.string().optional().or(z.literal('')),
  stage: stageField,
  notes: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
});

export const updateCustomerSchema = createCustomerSchema.partial();

export const listCustomersSchema = z.object({
  stage: stageField,
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(50),
  notEnrolledInAnySequence: z.coerce.boolean().optional().default(false),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type ListCustomersInput = z.infer<typeof listCustomersSchema>;
