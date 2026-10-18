import type { JsonObject } from '@orot/model-runtime';

/** Exhaustive classification cites every item; ordinary answers cite only evidence they actually use. */
export function taskCitationSchema(ids: readonly string[], requireAll = false): JsonObject {
  return {
    type: 'array',
    description: requireAll
      ? 'Return every supplied evidenceId exactly once. This task classifies every supplied item.'
      : 'Only evidenceId values actually used in this result. If the result contains nested evidence ID arrays, return their exact unique union. Never add unused IDs.',
    // An enum can encourage native generation to enumerate all IDs. Use it only
    // for exhaustive tasks; citationReferences still enforces the allowlist locally.
    items: requireAll && ids.length ? { type: 'string', enum: [...ids] } : { type: 'string' },
    ...(requireAll
      ? { minItems: ids.length, maxItems: ids.length }
      : ids.length
        ? {}
        : { maxItems: 0 }),
  };
}
