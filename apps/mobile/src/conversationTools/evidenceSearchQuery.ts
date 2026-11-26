import type { JsonObject } from '@orot/model-runtime';

/** Bounds model-selected query text before any local record read. */
export const plainQuerySchema: JsonObject = {
  type: 'object',
  required: ['query'],
  properties: { query: { type: 'string', minLength: 1, maxLength: 1000 } },
  additionalProperties: false,
};

export const querySchema: JsonObject = {
  ...plainQuerySchema,
  properties: {
    query: { type: 'string', minLength: 1, maxLength: 1000 },
    view: {
      type: 'string',
      enum: ['health_overview'],
      description:
        'Use for a bounded recent overview across medications, doses, measurements, activity, sleep and symptoms instead of relevance ranking of individual records.',
    },
  },
  additionalProperties: false,
};

export function queryInput(
  value: unknown,
  allowOverview = true,
): JsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(key => key !== 'query' && key !== 'view') ||
    (record.view !== undefined && record.view !== 'health_overview') ||
    (record.view !== undefined && !allowOverview) ||
    typeof record.query !== 'string' ||
    record.query.trim().length === 0 ||
    record.query.trim().length > 1000
  ) {
    return undefined;
  }
  return {
    query: record.query.trim(),
    ...(record.view ? { view: record.view } : {}),
  };
}
