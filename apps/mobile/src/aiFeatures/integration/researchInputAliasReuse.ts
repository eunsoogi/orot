import type { EvidenceReference } from '@orot/agent-runtime';
import type { SavedSummarySource } from '../../diseaseHypotheses/savedSummaries';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { AiFeatureLocalData } from './localData';
import { restoreRetainedSources } from './restoreRetainedSources';
import { captureConversationSources } from './captureConversationSources';
import { stableJson } from './evidenceUtils';

// Only descriptor-owned restoration is serialized. This does not deduplicate searches or replace readers.
const pending = new WeakMap<
  LocalEvidenceReferenceRegistry,
  Map<string, Promise<EvidenceReference>>
>();
/** Reuse a unique exact alias only after its existing reader proves the complete durable descriptor.
 * Parent/lineage guards remain on that reader; no global add policy or reader replacement is allowed. */
export async function reuseResearchInputAliases(
  sources: readonly SavedSummarySource[],
  registry: LocalEvidenceReferenceRegistry,
  data: AiFeatureLocalData,
  signal: AbortSignal,
): Promise<Map<string, EvidenceReference>> {
  let operations = pending.get(registry);
  if (!operations) {
    operations = new Map();
    pending.set(registry, operations);
  }
  const mapping = new Map<string, EvidenceReference>();
  const stillUnique = (original: string, alias: EvidenceReference) => {
    const matches = registry
      .snapshot()
      .entries.filter(row => stableJson(row.original) === original);
    return (
      matches.length === 1 &&
      stableJson(matches[0]!.alias) === stableJson(alias)
    );
  };
  for (const source of sources) {
    if (signal.aborted)
      throw new Error('Research input restoration cancelled.');
    const descriptor = stableJson(source),
      original = stableJson(source.reference);
    let operation = operations.get(descriptor);
    if (!operation) {
      operation = (async () => {
        let matches = registry
          .snapshot()
          .entries.filter(row => stableJson(row.original) === original);
        if (matches.length > 1)
          throw new Error('Ambiguous research input alias.');
        if (!matches.length) {
          const result = await restoreRetainedSources([source], registry, data);
          if (result.sourceChanged) throw new Error('Research input changed.');
          matches = registry
            .snapshot()
            .entries.filter(row => stableJson(row.original) === original);
        }
        // A concurrent search may have added another alias while storage was being read.
        if (matches.length !== 1 || signal.aborted)
          throw new Error('Research input alias unavailable.');
        const alias = matches[0]!.alias;
        const captured = await captureConversationSources(
          [alias],
          registry,
          signal,
        );
        if (
          captured.sources.length !== 1 ||
          stableJson(captured.sources[0]) !== descriptor ||
          signal.aborted
        )
          throw new Error('Research input descriptor changed.');
        if (!stillUnique(original, alias))
          throw new Error('Ambiguous research input alias.');
        return alias;
      })();
      operations.set(descriptor, operation);
    }
    try {
      const alias = await operation;
      if (signal.aborted)
        throw new Error('Research input restoration cancelled.');
      if (!stillUnique(original, alias))
        throw new Error('Ambiguous research input alias.');
      mapping.set(original, alias);
    } finally {
      if (operations.get(descriptor) === operation)
        operations.delete(descriptor);
    }
  }
  return mapping;
}
