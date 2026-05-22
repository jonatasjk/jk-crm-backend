import { parse } from 'csv-parse/sync';
import type { InvestorStage, PartnerStage, CustomerStage } from '../types/enums.js';

// Map common CSV column names to schema fields
const INVESTOR_FIELD_MAP: Record<string, string> = {
  first_name: 'firstName',
  firstname: 'firstName',
  given_name: 'firstName',
  last_name: 'lastName',
  lastname: 'lastName',
  surname: 'lastName',
  email: 'email',
  email_address: 'email',
  phone: 'phone',
  phone_number: 'phone',
  company: 'company',
  organization: 'company',
  firm: 'company',
  website: 'website',
  linkedin: 'linkedinUrl',
  linkedin_url: 'linkedinUrl',
  stage: 'stage',
  notes: 'notes',
  tags: 'tags',
};

const PARTNER_FIELD_MAP: Record<string, string> = {
  first_name: 'firstName',
  firstname: 'firstName',
  given_name: 'firstName',
  last_name: 'lastName',
  lastname: 'lastName',
  surname: 'lastName',
  email: 'email',
  email_address: 'email',
  phone: 'phone',
  phone_number: 'phone',
  company: 'company',
  organization: 'company',
  website: 'website',
  linkedin: 'linkedinUrl',
  linkedin_url: 'linkedinUrl',
  stage: 'stage',
  notes: 'notes',
  tags: 'tags',
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '_');
}

function mapRow(
  rawRow: Record<string, string>,
  fieldMap: Record<string, string>,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(rawRow)) {
    const normKey = normalizeHeader(rawKey);
    const schemaField = fieldMap[normKey];
    if (schemaField && value !== undefined && value !== '') {
      if (schemaField === 'tags') {
        mapped[schemaField] = value.split(',').map((t: string) => t.trim()).filter(Boolean);
      } else {
        mapped[schemaField] = value.trim();
      }
    }
  }
  return mapped;
}

const INVESTOR_STAGE_VALUES = new Set([
  'PROSPECT', 'CONTACTED', 'MEETING', 'DUE_DILIGENCE', 'TERM_SHEET', 'CLOSED_WON', 'CLOSED_LOST',
]);

const PARTNER_STAGE_VALUES = new Set([
  'LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'ACTIVE', 'INACTIVE',
]);

const CUSTOMER_FIELD_MAP: Record<string, string> = {
  first_name: 'firstName',
  firstname: 'firstName',
  given_name: 'firstName',
  last_name: 'lastName',
  lastname: 'lastName',
  surname: 'lastName',
  email: 'email',
  email_address: 'email',
  phone: 'phone',
  phone_number: 'phone',
  company: 'company',
  organization: 'company',
  website: 'website',
  linkedin: 'linkedinUrl',
  linkedin_url: 'linkedinUrl',
  stage: 'stage',
  notes: 'notes',
  tags: 'tags',
};

const CUSTOMER_STAGE_VALUES = new Set([
  'LEAD', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST', 'CHURNED',
]);

export function parseInvestorCsv(csvBuffer: Buffer): Record<string, unknown>[] {
  const records = parse(csvBuffer, { columns: true, skip_empty_lines: true, trim: true });
  return (records as Record<string, string>[]).map((row) => {
    const mapped = mapRow(row, INVESTOR_FIELD_MAP);
    if (mapped['stage'] && !INVESTOR_STAGE_VALUES.has(String(mapped['stage']).toUpperCase())) {
      mapped['stage'] = 'PROSPECT';
    } else if (mapped['stage']) {
      mapped['stage'] = String(mapped['stage']).toUpperCase() as InvestorStage;
    }
    if (!mapped['tags']) mapped['tags'] = [];
    return mapped;
  });
}

export function parsePartnerCsv(csvBuffer: Buffer): Record<string, unknown>[] {
  const records = parse(csvBuffer, { columns: true, skip_empty_lines: true, trim: true });
  return (records as Record<string, string>[]).map((row) => {
    const mapped = mapRow(row, PARTNER_FIELD_MAP);
    if (mapped['stage'] && !PARTNER_STAGE_VALUES.has(String(mapped['stage']).toUpperCase())) {
      mapped['stage'] = 'LEAD';
    } else if (mapped['stage']) {
      mapped['stage'] = String(mapped['stage']).toUpperCase() as PartnerStage;
    }
    if (!mapped['tags']) mapped['tags'] = [];
    return mapped;
  });
}

export function parseCustomerCsv(csvBuffer: Buffer): Record<string, unknown>[] {
  const records = parse(csvBuffer, { columns: true, skip_empty_lines: true, trim: true });
  return (records as Record<string, string>[]).map((row) => {
    const mapped = mapRow(row, CUSTOMER_FIELD_MAP);
    if (mapped['stage'] && !CUSTOMER_STAGE_VALUES.has(String(mapped['stage']).toUpperCase())) {
      mapped['stage'] = 'LEAD';
    } else if (mapped['stage']) {
      mapped['stage'] = String(mapped['stage']).toUpperCase() as CustomerStage;
    }
    if (!mapped['tags']) mapped['tags'] = [];
    return mapped;
  });
}
