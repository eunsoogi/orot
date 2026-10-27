import type {
  EvidenceReference,
  EvidenceSearchTool,
} from '@orot/agent-runtime';
import { LocalEvidenceReferenceRegistry } from '../aiFeatures/integration/evidenceRegistry';
import type { AiFeatureLocalData } from '../aiFeatures/integration/localData';
import { createHealthReviewEvidence } from '../agent/healthReview/evidence';

/** A result owns its exact tool aliases and registry, including fixed-period citation readers. */
export function createHealthReviewInvocation(data: AiFeatureLocalData) {
  const registry = new LocalEvidenceReferenceRegistry();
  const evidence = createHealthReviewEvidence(data, registry);
  if (!evidence) throw new Error('Health review evidence unavailable.');
  const aliases = new Map<string, EvidenceReference>();
  const capture = (tool: EvidenceSearchTool): EvidenceSearchTool => ({
    ...tool,
    async search(request, runtime) {
      const result = await tool.search(request, runtime);
      if (!('status' in result)) {
        for (const item of result.items) {
          // Retain every reference field from the tool output, not a canonical resolved identity.
          aliases.set(
            item.evidenceId,
            JSON.parse(JSON.stringify(item)) as EvidenceReference,
          );
        }
      }
      return result;
    },
  });
  return {
    evidence: {
      ...evidence,
      trends: capture(evidence.trends),
      records: capture(evidence.records),
    },
    aliases,
    readSource: (reference: EvidenceReference, signal: AbortSignal) =>
      registry.resolve(reference)
        ? registry.readSource(reference, signal)
        : Promise.resolve({ status: 'unavailable' as const }),
  };
}
