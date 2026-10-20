import { maskEmail, maskPhone, maskTaxId, redact, REDACTED } from './sensitive-data';

describe('sensitive data helpers', () => {
  it('redacts sensitive keys at any depth', () => {
    const result = redact({
      email: 'someone@example.com',
      password: 'hunter2hunter2',
      nested: { accessToken: 'abc', taxId: '12-3456789', note: 'keep me' },
      list: [{ Authorization: 'Bearer x' }],
    });

    expect(result).toEqual({
      email: 'someone@example.com',
      password: REDACTED,
      nested: { accessToken: REDACTED, taxId: REDACTED, note: 'keep me' },
      list: [{ Authorization: REDACTED }],
    });
  });

  it('leaves primitives and dates untouched', () => {
    const date = new Date();
    expect(redact('text')).toBe('text');
    expect(redact(null)).toBeNull();
    expect(redact({ at: date })).toEqual({ at: date });
  });

  it('masks tax ids keeping the last four characters', () => {
    expect(maskTaxId('12-3456789')).toBe('******6789');
    expect(maskTaxId('123')).toBe('****');
  });

  it('masks emails and phone numbers', () => {
    expect(maskEmail('owner@example.com')).toBe('o***@example.com');
    expect(maskEmail('invalid')).toBe('***');
    expect(maskPhone('+44 20 7946 0000')).toBe('***0000');
  });
});
