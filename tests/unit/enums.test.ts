import { describe, it, expect } from 'vitest';
import {
  Role,
  InvestorStage,
  PartnerStage,
  EntityType,
  EmailStatus,
  ActivityType,
} from '../../src/types/enums.js';

describe('Enums', () => {
  it('Role contains ADMIN and MEMBER', () => {
    expect(Role.ADMIN).toBe('ADMIN');
    expect(Role.MEMBER).toBe('MEMBER');
  });

  it('InvestorStage has all expected values', () => {
    const stages = Object.values(InvestorStage);
    expect(stages).toContain('PROSPECT');
    expect(stages).toContain('CONTACTED');
    expect(stages).toContain('MEETING');
    expect(stages).toContain('DUE_DILIGENCE');
    expect(stages).toContain('TERM_SHEET');
    expect(stages).toContain('CLOSED_WON');
    expect(stages).toContain('CLOSED_LOST');
    expect(stages).toHaveLength(7);
  });

  it('PartnerStage has all expected values', () => {
    const stages = Object.values(PartnerStage);
    expect(stages).toContain('LEAD');
    expect(stages).toContain('QUALIFIED');
    expect(stages).toContain('PROPOSAL');
    expect(stages).toContain('NEGOTIATION');
    expect(stages).toContain('ACTIVE');
    expect(stages).toContain('INACTIVE');
    expect(stages).toHaveLength(6);
  });

  it('EntityType has INVESTOR and PARTNER', () => {
    expect(EntityType.INVESTOR).toBe('INVESTOR');
    expect(EntityType.PARTNER).toBe('PARTNER');
  });

  it('EmailStatus has all expected values', () => {
    const statuses = Object.values(EmailStatus);
    expect(statuses).toContain('PENDING');
    expect(statuses).toContain('SENT');
    expect(statuses).toContain('FAILED');
    expect(statuses).toContain('FILE_MISSING');
    expect(statuses).toContain('DELIVERED');
    expect(statuses).toContain('BOUNCED');
    expect(statuses).toContain('COMPLAINED');
    expect(statuses).toContain('OPENED');
    expect(statuses).toContain('CLICKED');
    expect(statuses).toContain('DELIVERY_DELAYED');
    expect(statuses).toHaveLength(10);
  });

  it('ActivityType has all expected values', () => {
    const types = Object.values(ActivityType);
    expect(types).toContain('CREATED');
    expect(types).toContain('IMPORTED');
    expect(types).toContain('EMAIL_SENT');
    expect(types).toContain('STAGE_CHANGE');
    expect(types).toContain('NOTE_ADDED');
    expect(types).toHaveLength(5);
  });
});
