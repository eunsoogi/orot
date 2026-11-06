import type { EvidenceReference } from '@orot/agent-runtime';
import type {
  SavedRecordSummarySource,
  SavedSummarySource,
} from '../../diseaseHypotheses/savedSummaries';
import { healthContextRevision } from '../../healthEvidence/healthContext/scope';
import { fingerprint } from './evidenceUtils';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { savedManualHistorySource } from './manualHistoryEvidence';
import { RetainedSourceInvalidError } from './retainedSourceError';

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
    if (!original || read.status === 'missing' || read.status === 'changed')
      throw new RetainedSourceInvalidError(
        'The cited source changed before saving.',
      );
    if (read.status !== 'available')
      throw new Error('The cited source changed before saving.');
    if (read.document.sourceKind === 'health_context_period') {
      // A restored tool-only filter has no original input; it cannot become an unfiltered answer citation.
      if (read.document.filterRedacted)
        throw new RetainedSourceInvalidError(
          'The filtered tool source cannot be retained as a new citation.',
        );
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
    if (read.document.sourceKind === 'generated_artifact') {
      if (read.document.sourceStatus === 'changed')
        throw new RetainedSourceInvalidError(
          'The generated source changed before saving.',
        );
      const id = read.document.metadata.id;
      const revision = read.document.metadata.revision;
      const expectedType =
        'conversation' in read.document
          ? 'conversation_turn'
          : read.document.metadata.type;
      const locator = original.locator;
      const locatorObject =
        locator && typeof locator === 'object' && !Array.isArray(locator)
          ? (locator as Readonly<Record<string, unknown>>)
          : undefined;
      if (
        !id ||
        !revision ||
        locatorObject?.kind !== 'generated_artifact' ||
        locatorObject.type !== expectedType
      )
        throw new RetainedSourceInvalidError(
          'The generated source identity is invalid.',
        );
      if (
        'analysis' in read.document &&
        read.document.metadata.inputLineage !== 'complete'
      )
        throw new RetainedSourceInvalidError(
          'The generated summary has incomplete input lineage.',
        );
      const source =
        'research' in read.document
          ? { kind: 'generated_research' as const }
          : 'conversation' in read.document
            ? { kind: 'generated_conversation' as const }
            : { kind: 'generated_summary' as const };
      sources.push({ ...source, reference: original, id, revision });
      mapping.set(key, original);
      continue;
    }
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
