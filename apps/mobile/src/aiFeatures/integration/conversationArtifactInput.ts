import type { JsonObject } from '@orot/model-runtime';

/** Reject unbounded or extraneous provider search arguments. */
export function parseConversationArtifactInput(
  value: unknown,
): JsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(key => key !== 'query' && key !== 'cursor') ||
    typeof input.query !== 'string' ||
    !input.query.trim() ||
    input.query.length > 240 ||
    (input.cursor !== undefined &&
      (typeof input.cursor !== 'string' || input.cursor.length > 64))
  )
    return undefined;
  return {
    query: input.query.trim(),
    ...(input.cursor ? { cursor: input.cursor } : {}),
  };
}
