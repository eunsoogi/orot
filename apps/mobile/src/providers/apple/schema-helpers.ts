import type { JsonObject } from '@orot/model-runtime';
import type { AppleNativeSchema } from './schema-types';

export function ensureOnly(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) {
    throw codedError(
      'UNSUPPORTED_CAPABILITY',
      'Schema uses a keyword that cannot be represented.',
    );
  }
}

export function asSchema(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw codedError('INVALID_REQUEST', 'Nested schema must be an object.');
  }
  return value as JsonObject;
}

export function objectSchema(
  name: string,
  properties: readonly {
    readonly name: string;
    readonly schema: AppleNativeSchema;
    readonly optional?: boolean;
    readonly description?: string;
  }[],
): AppleNativeSchema {
  return {
    kind: 'object',
    name,
    properties: properties.map(property => ({
      name: property.name,
      schema: property.schema,
      optional: property.optional ?? false,
      description: property.description,
    })),
  };
}

export function enumSchema(
  name: string,
  values: readonly string[],
): AppleNativeSchema {
  return { kind: 'enum', name, values };
}

export function numberOption(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw codedError(
      'INVALID_REQUEST',
      name + ' must be a non-negative integer.',
    );
  }
  return value as number;
}

export function cleanName(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9]/gu, '');
  return safe || 'StructuredOutput';
}

export function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
