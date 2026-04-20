import { describe, it, expect } from 'vitest';
import {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../../src/schemas/auth.schema.js';
import { createInvestorSchema, updateInvestorSchema, listInvestorsSchema } from '../../src/schemas/investor.schema.js';
import { createPartnerSchema, updatePartnerSchema, listPartnersSchema } from '../../src/schemas/partner.schema.js';
import { sendEmailSchema } from '../../src/schemas/email.schema.js';
import { EntityType } from '../../src/types/enums.js';

describe('Auth schemas', () => {
  describe('registerSchema', () => {
    it('accepts valid input', () => {
      const result = registerSchema.parse({ email: 'a@b.com', password: 'password123', name: 'Alice' });
      expect(result.email).toBe('a@b.com');
    });
    it('rejects invalid email', () => {
      expect(() => registerSchema.parse({ email: 'not-email', password: 'password123', name: 'Alice' })).toThrow();
    });
    it('rejects short password', () => {
      expect(() => registerSchema.parse({ email: 'a@b.com', password: '1234567', name: 'Alice' })).toThrow();
    });
    it('rejects short name', () => {
      expect(() => registerSchema.parse({ email: 'a@b.com', password: 'password123', name: 'A' })).toThrow();
    });
  });

  describe('loginSchema', () => {
    it('accepts valid input', () => {
      const result = loginSchema.parse({ email: 'a@b.com', password: 'x' });
      expect(result.email).toBe('a@b.com');
    });
    it('rejects missing password', () => {
      expect(() => loginSchema.parse({ email: 'a@b.com', password: '' })).toThrow();
    });
  });

  describe('changePasswordSchema', () => {
    it('accepts valid input', () => {
      const result = changePasswordSchema.parse({ currentPassword: 'old', newPassword: 'newpassword1' });
      expect(result.newPassword).toBe('newpassword1');
    });
    it('rejects short new password', () => {
      expect(() => changePasswordSchema.parse({ currentPassword: 'old', newPassword: '1234567' })).toThrow();
    });
  });

  describe('forgotPasswordSchema', () => {
    it('accepts valid email', () => {
      expect(forgotPasswordSchema.parse({ email: 'a@b.com' }).email).toBe('a@b.com');
    });
    it('rejects invalid email', () => {
      expect(() => forgotPasswordSchema.parse({ email: 'not-valid' })).toThrow();
    });
  });

  describe('resetPasswordSchema', () => {
    it('accepts valid input', () => {
      const result = resetPasswordSchema.parse({ email: 'a@b.com', token: 'tok123', newPassword: 'newpassword1' });
      expect(result.token).toBe('tok123');
    });
    it('rejects empty token', () => {
      expect(() => resetPasswordSchema.parse({ email: 'a@b.com', token: '', newPassword: 'newpassword1' })).toThrow();
    });
  });
});

describe('Investor schemas', () => {
  const valid = { firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com' };

  it('createInvestorSchema accepts valid minimal input', () => {
    const result = createInvestorSchema.parse(valid);
    expect(result.tags).toEqual([]);
  });

  it('createInvestorSchema accepts known stage', () => {
    const result = createInvestorSchema.parse({ ...valid, stage: 'PROSPECT' });
    expect(result.stage).toBe('PROSPECT');
  });

  it('createInvestorSchema treats empty stage as undefined', () => {
    const result = createInvestorSchema.parse({ ...valid, stage: '' });
    expect(result.stage).toBeUndefined();
  });

  it('createInvestorSchema rejects invalid email', () => {
    expect(() => createInvestorSchema.parse({ ...valid, email: 'bad' })).toThrow();
  });

  it('updateInvestorSchema allows partial updates', () => {
    const result = updateInvestorSchema.parse({ firstName: 'Bob' });
    expect(result.firstName).toBe('Bob');
    expect(result.email).toBeUndefined();
  });

  it('listInvestorsSchema applies defaults', () => {
    const result = listInvestorsSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(50);
  });

  it('listInvestorsSchema coerces numeric strings', () => {
    const result = listInvestorsSchema.parse({ page: '2', limit: '10' });
    expect(result.page).toBe(2);
    expect(result.limit).toBe(10);
  });
});

describe('Partner schemas', () => {
  const valid = { firstName: 'Bob', lastName: 'Jones', email: 'bob@example.com' };

  it('createPartnerSchema accepts valid minimal input', () => {
    const result = createPartnerSchema.parse(valid);
    expect(result.tags).toEqual([]);
  });

  it('createPartnerSchema treats empty stage as undefined', () => {
    const result = createPartnerSchema.parse({ ...valid, stage: '' });
    expect(result.stage).toBeUndefined();
  });

  it('updatePartnerSchema allows partial updates', () => {
    const result = updatePartnerSchema.parse({ company: 'Acme' });
    expect(result.company).toBe('Acme');
  });

  it('listPartnersSchema applies defaults', () => {
    const result = listPartnersSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.limit).toBe(50);
  });
});

describe('Email schema', () => {
  it('sendEmailSchema accepts valid input', () => {
    const result = sendEmailSchema.parse({
      entityId: 'abc123',
      entityType: EntityType.INVESTOR,
      subject: 'Hello',
      body: '<p>Hi</p>',
    });
    expect(result.materialIds).toEqual([]);
  });

  it('sendEmailSchema rejects invalid entityType', () => {
    expect(() =>
      sendEmailSchema.parse({ entityId: 'abc', entityType: 'INVALID', subject: 'Hi', body: 'Body' }),
    ).toThrow();
  });

  it('sendEmailSchema rejects empty subject', () => {
    expect(() =>
      sendEmailSchema.parse({ entityId: 'abc', entityType: EntityType.INVESTOR, subject: '', body: 'Body' }),
    ).toThrow();
  });
});
