import { describe, it, expect } from 'vitest';
import { parseInvestorCsv, parsePartnerCsv } from '../../src/services/csv.service.js';

const investorCsv = `first_name,last_name,email,phone,company,stage,notes,tags
Alice,Smith,alice@example.com,555-1234,Acme Inc,PROSPECT,Some notes,"tech, vc"
Bob,Jones,bob@example.com,,,MEETING,,
Charlie,Brown,charlie@example.com,,,,, 
`;

const investorCsvAltHeaders = `firstname,surname,email_address,organization
Dave,White,dave@example.com,Widgets Co
`;

const partnerCsv = `first_name,last_name,email,company,stage
Eve,Green,eve@example.com,Partners Ltd,ACTIVE
Frank,Black,frank@example.com,,LEAD
`;

const invalidStageCsv = `first_name,last_name,email,stage
Grace,Hill,grace@example.com,UNKNOWN_STAGE
`;

const invalidPartnerStageCsv = `first_name,last_name,email,stage
Henry,Lake,henry@example.com,TOTALLY_WRONG
`;

describe('parseInvestorCsv', () => {
  it('parses standard header names correctly', () => {
    const rows = parseInvestorCsv(Buffer.from(investorCsv));
    expect(rows).toHaveLength(3);

    const alice = rows[0]!;
    expect(alice['firstName']).toBe('Alice');
    expect(alice['lastName']).toBe('Smith');
    expect(alice['email']).toBe('alice@example.com');
    expect(alice['phone']).toBe('555-1234');
    expect(alice['company']).toBe('Acme Inc');
    expect(alice['stage']).toBe('PROSPECT');
    expect(alice['notes']).toBe('Some notes');
    expect(alice['tags']).toEqual(['tech', 'vc']);
  });

  it('handles rows with empty optional fields', () => {
    const rows = parseInvestorCsv(Buffer.from(investorCsv));
    const bob = rows[1]!;
    expect(bob['firstName']).toBe('Bob');
    expect(bob['phone']).toBeUndefined();
    expect(bob['tags']).toEqual([]);
  });

  it('parses alternative header names', () => {
    const rows = parseInvestorCsv(Buffer.from(investorCsvAltHeaders));
    expect(rows).toHaveLength(1);
    const dave = rows[0]!;
    expect(dave['firstName']).toBe('Dave');
    expect(dave['lastName']).toBe('White');
    expect(dave['email']).toBe('dave@example.com');
    expect(dave['company']).toBe('Widgets Co');
  });

  it('falls back to PROSPECT for unknown investor stage', () => {
    const rows = parseInvestorCsv(Buffer.from(invalidStageCsv));
    expect(rows[0]!['stage']).toBe('PROSPECT');
  });

  it('uppercases valid investor stages', () => {
    const csv = `first_name,last_name,email,stage\nIvy,Park,ivy@example.com,meeting\n`;
    const rows = parseInvestorCsv(Buffer.from(csv));
    expect(rows[0]!['stage']).toBe('MEETING');
  });

  it('sets empty tags array when tags column is absent', () => {
    const csv = `first_name,last_name,email\nJack,Frost,jack@example.com\n`;
    const rows = parseInvestorCsv(Buffer.from(csv));
    expect(rows[0]!['tags']).toEqual([]);
  });
});

describe('parsePartnerCsv', () => {
  it('parses standard partner CSV', () => {
    const rows = parsePartnerCsv(Buffer.from(partnerCsv));
    expect(rows).toHaveLength(2);
    const eve = rows[0]!;
    expect(eve['firstName']).toBe('Eve');
    expect(eve['stage']).toBe('ACTIVE');
  });

  it('handles empty company for partner', () => {
    const rows = parsePartnerCsv(Buffer.from(partnerCsv));
    const frank = rows[1]!;
    expect(frank['company']).toBeUndefined();
  });

  it('falls back to LEAD for unknown partner stage', () => {
    const rows = parsePartnerCsv(Buffer.from(invalidPartnerStageCsv));
    expect(rows[0]!['stage']).toBe('LEAD');
  });

  it('uppercases valid partner stages', () => {
    const csv = `first_name,last_name,email,stage\nKate,Snow,kate@example.com,qualified\n`;
    const rows = parsePartnerCsv(Buffer.from(csv));
    expect(rows[0]!['stage']).toBe('QUALIFIED');
  });

  it('sets empty tags array when absent', () => {
    const csv = `first_name,last_name,email\nLeo,Sun,leo@example.com\n`;
    const rows = parsePartnerCsv(Buffer.from(csv));
    expect(rows[0]!['tags']).toEqual([]);
  });

  it('parses tags comma-separated', () => {
    const csv = `first_name,last_name,email,tags\nMia,Ray,mia@example.com,"partner, vip, tech"\n`;
    const rows = parsePartnerCsv(Buffer.from(csv));
    expect(rows[0]!['tags']).toEqual(['partner', 'vip', 'tech']);
  });
});
