import { z } from 'zod';
import { EntityType } from '../types/enums.js';

export const sendEmailSchema = z.object({
  entityId: z.string().min(1),
  entityType: z.nativeEnum(EntityType),
  subject: z.string().min(1).max(500),
  body: z.string().min(1),
  materialIds: z.array(z.string()).optional().default([]),
});

export type SendEmailInput = z.infer<typeof sendEmailSchema>;
