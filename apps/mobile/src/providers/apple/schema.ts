import type { JsonObject, ToolDefinition } from '@orot/model-runtime';

export type AppleNativeSchema =
  | { readonly kind: 'string' | 'integer' | 'number' | 'boolean' }
  | { readonly kind: 'enum'; readonly name: string; readonly values: readonly string[] }
  | {
      readonly kind: 'array';
      readonly item: AppleNativeSchema;
      readonly minimumElements?: number;
      readonly maximumElements?: number;
    }
  | {
      readonly kind: 'object';
      readonly name: string;
      readonly properties: readonly {
        readonly name: string;
        readonly schema: AppleNativeSchema;
        readonly optional: boolean;
        readonly description?: string;
      }[];
    }
  | { readonly kind: 'union'; readonly name: string; readonly choices: readonly AppleNativeSchema[] };

export interface AppleNativeRequest {
  readonly instructions: string;
  readonly prompt: string;
  readonly mode: 'text' | 'structured' | 'tools' | 'mixed';
  readonly schema?: AppleNativeSchema;
  readonly toolNames: readonly string[];
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
}

export function compileResponseSchema(
  tools: readonly ToolDefinition[],
  responseSchema?: JsonObject,
  responseName = 'StructuredOutput',
): AppleNativeSchema | undefined {
  if (!tools.length) {
    return responseSchema ? compileSchema(responseSchema, cleanName(responseName)) : undefined;
  }
  const choices: AppleNativeSchema[] = [];
  if (responseSchema) {
    choices.push(objectSchema('StructuredChoice', [
      { name: 'kind', schema: enumSchema('StructuredKind', ['structured']) },
      { name: 'value', schema: compileSchema(responseSchema, 'StructuredValue') },
    ]));
  }
  const toolVariants = tools.map((tool, index) => {
    const args = compileSchema(tool.inputSchema, 'ToolArguments' + index);
    if (args.kind !== 'object') {
      throw codedError('INVALID_REQUEST', 'Tool input schemas must describe an object.');
    }
    return objectSchema('ToolCall' + index, [
      { name: 'name', schema: enumSchema('ToolName' + index, [tool.name]) },
      { name: 'arguments', schema: args },
    ]);
  });
  choices.push(objectSchema('ToolCallsChoice', [
    { name: 'kind', schema: enumSchema('ToolCallsKind', ['tool_calls']) },
    {
      name: 'toolCalls',
      schema: {
        kind: 'array',
        item: { kind: 'union', name: 'ToolCallChoiceItem', choices: toolVariants },
        minimumElements: 1,
        maximumElements: 8,
      },
    },
  ]));
  choices.push(objectSchema('TextChoice', [
    { name: 'kind', schema: enumSchema('TextKind', ['text']) },
    { name: 'text', schema: { kind: 'string' } },
  ]));
  return { kind: 'union', name: 'OrotResponse', choices };
}

function compileSchema(raw: JsonObject, name: string): AppleNativeSchema {
  const value = raw as Record<string, unknown>;
  const allowed = new Set([
    'type', 'title', 'description', 'properties', 'required', 'items', 'enum',
    'minItems', 'maxItems', 'additionalProperties', 'anyOf',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw codedError('UNSUPPORTED_CAPABILITY', 'Schema uses an unsupported JSON Schema keyword.');
  }
  if (value.anyOf !== undefined) {
    ensureOnly(value, ['anyOf', 'title', 'description']);
    if (!Array.isArray(value.anyOf) || value.anyOf.length === 0) {
      throw codedError('INVALID_REQUEST', 'Schema anyOf must contain choices.');
    }
    return {
      kind: 'union',
      name,
      choices: value.anyOf.map((choice, index) =>
        compileSchema(asSchema(choice), name + 'Choice' + index),
      ),
    };
  }
  if (value.enum !== undefined) {
    ensureOnly(value, ['type', 'title', 'description', 'enum']);
    if (value.type !== undefined && value.type !== 'string') {
      throw codedError('INVALID_REQUEST', 'Only string enum schemas are supported.');
    }
    if (!Array.isArray(value.enum) || value.enum.length === 0
      || !value.enum.every((item) => typeof item === 'string')) {
      throw codedError('UNSUPPORTED_CAPABILITY', 'Only non-empty string enums are supported.');
    }
    return enumSchema(name, value.enum as string[]);
  }
  switch (value.type) {
    case 'string':
    case 'integer':
    case 'number':
    case 'boolean':
      ensureOnly(value, ['type', 'title', 'description']);
      return { kind: value.type };
    case 'array': {
      ensureOnly(value, ['type', 'title', 'description', 'items', 'minItems', 'maxItems']);
      if (!value.items) throw codedError('INVALID_REQUEST', 'Array schema needs items.');
      const minimumElements = numberOption(value.minItems, 'minItems');
      const maximumElements = numberOption(value.maxItems, 'maxItems');
      if (minimumElements !== undefined && maximumElements !== undefined
        && minimumElements > maximumElements) {
        throw codedError('INVALID_REQUEST', 'Array schema has an invalid item range.');
      }
      return {
        kind: 'array',
        item: compileSchema(asSchema(value.items), name + 'Item'),
        minimumElements,
        maximumElements,
      };
    }
    case 'object': {
      ensureOnly(value, ['type', 'title', 'description', 'properties', 'required', 'additionalProperties']);
      if (value.additionalProperties !== undefined && value.additionalProperties !== false) {
        throw codedError('UNSUPPORTED_CAPABILITY', 'Schema additionalProperties must be false.');
      }
      if (value.properties !== undefined
        && (!value.properties || typeof value.properties !== 'object' || Array.isArray(value.properties))) {
        throw codedError('INVALID_REQUEST', 'Object schema properties must be an object.');
      }
      if (value.required !== undefined
        && (!Array.isArray(value.required) || !value.required.every((item) => typeof item === 'string'))) {
        throw codedError('INVALID_REQUEST', 'Object schema required must be a string array.');
      }
      const properties = (value.properties ?? {}) as Record<string, unknown>;
      const required = new Set((value.required ?? []) as string[]);
      if ([...required].some((key) => !(key in properties))) {
        throw codedError('INVALID_REQUEST', 'Required schema property is missing.');
      }
      return objectSchema(name, Object.keys(properties).sort().map((key, index) => {
        const schema = asSchema(properties[key]);
        return {
          name: key,
          schema: compileSchema(schema, name + 'Field' + index),
          optional: !required.has(key),
          description: typeof schema.description === 'string' ? schema.description : undefined,
        };
      }));
    }
    default:
      throw codedError('UNSUPPORTED_CAPABILITY', 'Schema type is unsupported.');
  }
}

function ensureOnly(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw codedError('UNSUPPORTED_CAPABILITY', 'Schema uses a keyword that cannot be represented.');
  }
}

function asSchema(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw codedError('INVALID_REQUEST', 'Nested schema must be an object.');
  }
  return value as JsonObject;
}

function objectSchema(
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
    properties: properties.map((property) => ({
      name: property.name,
      schema: property.schema,
      optional: property.optional ?? false,
      description: property.description,
    })),
  };
}

function enumSchema(name: string, values: readonly string[]): AppleNativeSchema {
  return { kind: 'enum', name, values };
}

function numberOption(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw codedError('INVALID_REQUEST', name + ' must be a non-negative integer.');
  }
  return value as number;
}

function cleanName(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9]/gu, '');
  return safe || 'StructuredOutput';
}

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
