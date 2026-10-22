import type { JsonObject } from '@orot/model-runtime';

/** Exhaustive classification cites every item; ordinary answers cite only evidence they actually use. */
export function taskCitationSchema(
  ids: readonly string[],
  requireAll = false,
  constrainIds = false,
): JsonObject {
  return {
    type: 'array',
    description: requireAll
      ? 'Return every supplied evidenceId exactly once. This task classifies every supplied item.'
      : 'Only evidenceId values actually used in this result. If the result contains nested evidence ID arrays, return their exact unique union. Never add unused IDs.',
    // Enums can encourage enumeration. Ordinary tasks must explicitly opt in;
    // citationReferences still binds every generated ID and rejects duplicates.
    items:
      (requireAll || constrainIds) && ids.length
        ? { type: 'string', enum: [...ids] }
        : { type: 'string' },
    ...(requireAll
      ? { minItems: ids.length, maxItems: ids.length }
      : ids.length
        ? {}
        : { maxItems: 0 }),
  };
}
