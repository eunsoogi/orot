import { healthContextToolDefinition } from '../aiFeatures/integration/healthContextToolDefinition';
import type { loadCanonicalLiveHealthSettings } from '../voiceSettings/liveCanonicalHealthSettings';
import { canonicalLiveHealthDeclaration } from './canonicalLiveHealthRead';

/** Descriptor construction cannot open or read storage. The actual canonical
 * tool executes separately only after a fresh exact native challenge and consent. */
export function canonicalLiveHealthRegistration(
  selection: NonNullable<
    Awaited<ReturnType<typeof loadCanonicalLiveHealthSettings>>
  >,
) {
  if (!selection.current()) return;
  const declaration = canonicalLiveHealthDeclaration(
    healthContextToolDefinition('rag'),
  );
  if (!declaration || !selection.current()) return;
  return Object.freeze({
    canonicalHealthGrant: Object.freeze({ ...selection.binding }),
    canonicalHealthDeclaration: Object.freeze(declaration),
  });
}
