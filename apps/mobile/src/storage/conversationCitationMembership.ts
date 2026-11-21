import { stableJson } from '../aiFeatures/integration/evidenceUtils';

/** Decode-local canonical membership, never a source-validity cache. Advance only
 * as far as a citation needs: unused later locators must not be serialized, since
 * the original short-circuit scan may never encounter their recursion errors.
 * Parsed JSON has no getters/mutation; cached strings cannot alter returned data. */
export function hasConversationCitationReferences(
  sources: readonly Record<string, unknown>[],
  citations: readonly unknown[],
): boolean {
  const seen = new Set<string>();
  let next = 0;
  for (const citation of citations) {
    if (sources.length === 0) return false;
    // Preserve the original first-source-before-target evaluation on first use.
    if (next === 0) seen.add(stableJson(sources[next++].reference));
    const target = stableJson(citation);
    if (seen.has(target)) continue;
    let matched = false;
    while (next < sources.length) {
      const source = stableJson(sources[next++].reference);
      seen.add(source);
      if (source === target) {
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
}
