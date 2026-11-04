import type { EvidenceReference } from '@orot/agent-runtime';
import type {
  SavedRecordSummarySource,
  SavedSummarySource,
} from '../../diseaseHypotheses/savedSummaries';
import { healthContextRevision } from '../../healthEvidence/healthContext/scope';
import { fingerprint } from './evidenceUtils';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { savedManualHistorySource } from './manualHistoryEvidence';

/** Resolve every admitted input to durable local identities before any derived text is saved. */
export async function captureEvidenceSources(
  references: readonly EvidenceReference[],
  registry: LocalEvidenceReferenceRegistry,
  signal: AbortSignal,
) {
  const mapping = new Map<string, EvidenceReference>();
  const sources: SavedSummarySource[] = [];
  for (const ref of references) {
    const key = JSON.stringify(ref);
    if (mapping.has(key)) continue;
    if (signal.aborted) throw new Error('Saving was cancelled.');
    if (ref.sourceKind === 'external_medical') {
      sources.push({ reference: ref, records: [] });
      mapping.set(key, ref);
      continue;
    }
    const original = registry.resolve(ref);
    const read = await registry.readSource(ref, signal);
    if (!original || read.status !== 'available')
      throw new Error('The cited source changed before saving.');
    if (read.document.sourceKind === 'health_context_period') {
      const { scope, report } = read.document;
      sources.push({
        kind: 'health_context_period',
        reference: original,
        scope,
        revision: healthContextRevision(scope, report),
        deletionGeneration: report.deletionGeneration,
      });
      mapping.set(key, original);
      continue;
    }
    // A generated parent needs its own transitive deletion link before reuse can be retained.
    if (read.document.sourceKind === 'generated_artifact')
      throw new Error('Generated artifacts require explicit lineage support.');
    const records: SavedRecordSummarySource['records'] =
      read.document.sourceKind === 'personal_record'
        ? read.document.records.map(entry => ({
            kind: entry.kind,
            id: entry.record.id,
            revision: fingerprint(entry.record),
          }))
        : read.document.sourceKind === 'manual_history'
          ? [savedManualHistorySource(read.document.evidence)]
          : [
              {
                kind: 'reviewed_memory',
                id: read.document.record.id,
                revision: fingerprint({
                  text: read.document.record.text,
                  meta: read.document.record.meta,
                }),
              },
            ];
    sources.push({ reference: original, records });
    mapping.set(key, original);
  }
  return { mapping, sources };
}
