import { z } from 'zod';
import { PartnerStage } from '../types/enums.js';

const stageField = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.nativeEnum(PartnerStage).optional(),
);

export const createPartnerSchema = z.object({
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

export const updatePartnerSchema = createPartnerSchema.partial();

export const listPartnersSchema = z.object({
  stage: stageField,
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(50),
});

export type CreatePartnerInput = z.infer<typeof createPartnerSchema>;
export type UpdatePartnerInput = z.infer<typeof updatePartnerSchema>;
export type ListPartnersInput = z.infer<typeof listPartnersSchema>;
