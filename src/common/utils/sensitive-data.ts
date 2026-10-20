const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'secret',
  'taxid',
  'ownerphone',
  'owneremail',
]);

export const REDACTED = '[REDACTED]';

export function redact<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => redact(item)) as T;
  if (value === null || typeof value !== 'object' || value instanceof Date) return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, field]) => [
      key,
      SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : redact(field),
    ]),
  ) as T;
}

export function maskTaxId(taxId: string): string {
  return taxId.length <= 4 ? '****' : `${'*'.repeat(taxId.length - 4)}${taxId.slice(-4)}`;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.charAt(0)}***@${domain}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length <= 4 ? '****' : `***${digits.slice(-4)}`;
}
