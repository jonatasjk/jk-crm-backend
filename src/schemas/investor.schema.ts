import { z } from 'zod';
import { InvestorStage } from '../types/enums.js';

const stageField = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.nativeEnum(InvestorStage).optional(),
);

export const createInvestorSchema = z.object({
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

export const updateInvestorSchema = createInvestorSchema.partial();

export const listInvestorsSchema = z.object({
  stage: stageField,
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(50),
});

export type CreateInvestorInput = z.infer<typeof createInvestorSchema>;
export type UpdateInvestorInput = z.infer<typeof updateInvestorSchema>;
export type ListInvestorsInput = z.infer<typeof listInvestorsSchema>;
