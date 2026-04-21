export const Role = {
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const InvestorStage = {
  PROSPECT: 'PROSPECT',
  CONTACTED: 'CONTACTED',
  MEETING: 'MEETING',
  DUE_DILIGENCE: 'DUE_DILIGENCE',
  TERM_SHEET: 'TERM_SHEET',
  CLOSED_WON: 'CLOSED_WON',
  CLOSED_LOST: 'CLOSED_LOST',
} as const;
export type InvestorStage = (typeof InvestorStage)[keyof typeof InvestorStage];

export const PartnerStage = {
  LEAD: 'LEAD',
  QUALIFIED: 'QUALIFIED',
  PROPOSAL: 'PROPOSAL',
  NEGOTIATION: 'NEGOTIATION',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type PartnerStage = (typeof PartnerStage)[keyof typeof PartnerStage];

export const EntityType = {
  INVESTOR: 'INVESTOR',
  PARTNER: 'PARTNER',
} as const;
export type EntityType = (typeof EntityType)[keyof typeof EntityType];

export const EmailStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  FILE_MISSING: 'FILE_MISSING',
  DELIVERED: 'DELIVERED',
  BOUNCED: 'BOUNCED',
  COMPLAINED: 'COMPLAINED',
  OPENED: 'OPENED',
  CLICKED: 'CLICKED',
  DELIVERY_DELAYED: 'DELIVERY_DELAYED',
} as const;
export type EmailStatus = (typeof EmailStatus)[keyof typeof EmailStatus];

export const ActivityType = {
  CREATED: 'CREATED',
  IMPORTED: 'IMPORTED',
  EMAIL_SENT: 'EMAIL_SENT',
  STAGE_CHANGE: 'STAGE_CHANGE',
  NOTE_ADDED: 'NOTE_ADDED',
} as const;
export type ActivityType = (typeof ActivityType)[keyof typeof ActivityType];
