/** Convert accepted LangChain schema forms to safe JSON data and validate parsed results. */
import { Validator, toJsonSchema } from '@langchain/core/utils/json_schema';
import { isSerializableSchema } from '@langchain/core/utils/standard_schema';
import type { SerializableSchema } from '@langchain/core/utils/standard_schema';
import type { ZodV3Like, ZodV4Like } from '@langchain/core/utils/types';
import type { StructuredOutputMethodOptions } from '@langchain/core/language_models/base';
import type {
  JsonObject,
  JsonValue,
  LanguageModelCapabilities,
  StructuredOutputFormat,
} from '@orot/model-runtime';

export type StructuredOutputSchema<RunOutput extends Record<string, any>> =
  SerializableSchema<RunOutput> | ZodV3Like<RunOutput> | ZodV4Like<RunOutput> | Record<string, any>;

export interface StructuredOutputPlan {
  readonly mode: 'native' | 'json_prompt';
  readonly format: StructuredOutputFormat;
  readonly instruction: string;
}

export interface PreparedStructuredOutput {
  readonly plan: StructuredOutputPlan;
  readonly parse: (value: unknown) => Promise<unknown>;
}

export type CreateStructuredOutputError = (
  code: 'invalid_request' | 'unsupported_capability',
) => Error;

/** Keep schema failures separate from domain-specific citation and evidence validation. */
export class StructuredOutputError extends Error {
  readonly code = 'invalid_output';

  constructor() {
    super('The model response did not match the requested structured output.');
    this.name = 'StructuredOutputError';
  }
}

type StandardSchemaResult = { readonly value?: unknown; readonly issues?: unknown };
type StandardSchemaLike = {
  readonly '~standard'?: {
    readonly validate?: (value: unknown) => StandardSchemaResult | Promise<StandardSchemaResult>;
  };
};
type RuntimeSchemaLike = {
  readonly parseAsync?: (value: unknown) => Promise<unknown>;
  readonly safeParseAsync?: (value: unknown) => Promise<{ success: boolean; data?: unknown }>;
  readonly parse?: (value: unknown) => unknown;
  readonly safeParse?: (value: unknown) => { success: boolean; data?: unknown };
};

function failRequest(createError: CreateStructuredOutputError): never {
  throw createError('invalid_request');
}

function failCapability(createError: CreateStructuredOutputError): never {
  throw createError('unsupported_capability');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** Copy only plain JSON data so schemas cannot carry cycles, getters, or executable values. */
function copyJsonValue(value: unknown, ancestors = new Set<object>()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || ancestors.has(value))
    throw new Error('Invalid schema.');
  if (Object.getOwnPropertySymbols(value).length) throw new Error('Invalid schema.');
  ancestors.add(value);
  const copied = Array.isArray(value)
    ? Array.from(value, (item) => copyJsonValue(item, ancestors))
    : isPlainObject(value)
      ? Object.fromEntries(
          Object.keys(value).map((key) => {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !('value' in descriptor)) throw new Error('Invalid schema.');
            return [key, copyJsonValue(descriptor.value, ancestors)];
          }),
        )
      : (() => {
          throw new Error('Invalid schema.');
        })();
  ancestors.delete(value);
  return copied;
}

function jsonSchemaFor(
  outputSchema: unknown,
  createError: CreateStructuredOutputError,
): JsonObject {
  try {
    const copied = copyJsonValue(toJsonSchema(outputSchema as never));
    if (!isPlainObject(copied)) return failRequest(createError);
    return copied as JsonObject;
  } catch {
    return failRequest(createError);
  }
}

function outputName(schema: JsonObject, config?: StructuredOutputMethodOptions<boolean>): string {
  const candidate = config?.name ?? schema.title ?? 'structured_output';
  if (typeof candidate !== 'string' || !candidate.trim()) throw new Error('Invalid output name.');
  return candidate;
}

/** Convert LangChain schema forms to one provider-neutral plan and one local validator. */
export function prepareStructuredOutput(
  capabilities: LanguageModelCapabilities,
  outputSchema: unknown,
  config: StructuredOutputMethodOptions<boolean> | undefined,
  createError: CreateStructuredOutputError,
): PreparedStructuredOutput {
  if (config?.strict) return failCapability(createError);
  const schema = jsonSchemaFor(outputSchema, createError);
  let validator: Validator;
  try {
    validator = new Validator(schema as never);
  } catch {
    return failRequest(createError);
  }

  const method = config?.method;
  let mode: StructuredOutputPlan['mode'];
  if (method === undefined) mode = capabilities.structuredOutput ? 'native' : 'json_prompt';
  else if (method === 'jsonSchema') {
    if (!capabilities.structuredOutput) return failCapability(createError);
    mode = 'native';
  } else if (method === 'jsonMode') mode = 'json_prompt';
  else return failCapability(createError);

  let name: string;
  try {
    name = outputName(schema, config);
  } catch {
    return failRequest(createError);
  }
  const format: StructuredOutputFormat = { name, schema };
  const instruction = [
    'Return one JSON value that matches the JSON Schema below.',
    'Do not add Markdown fences or text outside the JSON value.',
    `JSON Schema: ${JSON.stringify(schema)}`,
  ].join('\n');
  const runtimeSchema = outputSchema as RuntimeSchemaLike & StandardSchemaLike;
  const standardValidate = runtimeSchema['~standard']?.validate;
  const parse = async (value: unknown) => {
    try {
      if (!validator.validate(value).valid) throw new StructuredOutputError();
      if (isSerializableSchema(outputSchema) && standardValidate) {
        const result = await standardValidate.call(runtimeSchema['~standard'], value);
        if (result.issues !== undefined || !('value' in result)) throw new StructuredOutputError();
        return result.value;
      }
      if (typeof runtimeSchema.parseAsync === 'function')
        return await runtimeSchema.parseAsync(value);
      if (typeof runtimeSchema.safeParseAsync === 'function') {
        const result = await runtimeSchema.safeParseAsync(value);
        if (!result.success || !('data' in result)) throw new StructuredOutputError();
        return result.data;
      }
      if (typeof runtimeSchema.parse === 'function') return runtimeSchema.parse(value);
      if (typeof runtimeSchema.safeParse === 'function') {
        const result = runtimeSchema.safeParse(value);
        if (!result.success || !('data' in result)) throw new StructuredOutputError();
        return result.data;
      }
      return value;
    } catch {
      throw new StructuredOutputError();
    }
  };
  return { plan: { mode, format, instruction }, parse };
}
