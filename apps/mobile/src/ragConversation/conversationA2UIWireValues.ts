const maxText = 2_048;
const invalidKeyCharacter = /[^a-zA-Z0-9_-]/;

export function fail(): never {
  throw new Error('Invalid or unsupported A2UI surface');
}

// Only called on values obtained from JSON.parse or on records built in this module.
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}

export function keys(
  record: Record<string, unknown>,
  allowed: readonly string[],
) {
  if (Object.keys(record).some(key => !allowed.includes(key))) fail();
}

export function id(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > 64 ||
    invalidKeyCharacter.test(value) ||
    value === '__proto__' ||
    value === 'constructor' ||
    value === 'prototype'
  )
    fail();
  return value;
}

export function binding(value: unknown): readonly string[] {
  if (typeof value !== 'string' || value.length > 320 || !value.startsWith('/'))
    fail();
  const parts = value.slice(1).split('/');
  if (parts.length > 6) fail();
  return parts.map(id);
}

export function displayText(value: unknown): string {
  if (typeof value !== 'string' || value.length > maxText) fail();
  return value;
}

/** Only strict literal or a bounded JSON pointer can supply a text value. */
export function dataString(value: unknown): string | readonly string[] {
  if (typeof value === 'string') return displayText(value);
  const ref = object(value);
  keys(ref, ['@path']);
  return binding(ref['@path']);
}
