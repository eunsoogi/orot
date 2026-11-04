import type { EvidenceReference, EvidenceItem } from '@orot/agent-runtime';
import type { SavedSummarySource } from '../../diseaseHypotheses/savedSummaries';
import { isPeriodSummarySource } from '../../diseaseHypotheses/savedSummaries';
import { referenceOnly } from '../../diseaseHypotheses/resultValidation';
import { healthContextRevision } from '../../healthEvidence/healthContext/scope';
import type { AiFeatureLocalData } from './localData';
import type {
  EvidenceSourceReadResult,
  LocalEvidenceReferenceRegistry,
} from './evidenceRegistry';
import { fingerprint, stableJson } from './evidenceUtils';
import { healthOverviewFacts } from './healthOverviewFacts';
import {
  healthContextContent,
  registerHealthContextEvidence,
} from './healthContextEvidence';
import {
  manualHistorySummaryReviewEvidence,
  readSavedManualHistorySource,
} from './manualHistoryEvidence';

/** Rebuild turn-local aliases only after checking each durable source revision. */
export async function restoreRetainedSources(
  sources: readonly SavedSummarySource[],
  registry: LocalEvidenceReferenceRegistry,
  data: AiFeatureLocalData,
) {
  const mapping = new Map<string, EvidenceReference>();
  let sourceChanged = false;
  const reviewEvidence: EvidenceItem[] = [];
  for (const source of sources) {
    // Stored data can contain extra fields; only the public reference contract may enter a new alias.
    const reference = referenceOnly(source.reference);
    if (isPeriodSummarySource(source)) {
      const read = data.readHealthContext;
      const report = read
        ? await read(source.scope.window, [source.scope.topic])
        : undefined;
      sourceChanged ||=
        !report ||
        healthContextRevision(source.scope, report) !== source.revision;
      const current =
        report && read
          ? registerHealthContextEvidence({
              registry,
              read,
              report,
              scope: source.scope,
              original: reference,
              expectedRevision: source.revision,
            })
          : registry.add({
              reference,
              content: '',
              validate: async () => false,
              readSource: async () => ({ status: 'unavailable' }),
            });
      if (
        report &&
        healthContextRevision(source.scope, report) === source.revision
      )
        reviewEvidence.push({
          ...source.reference,
          content: healthContextContent(source.scope, report),
        });
      mapping.set(stableJson(source.reference), referenceOnly(current));
      continue;
    }
    if (source.reference.sourceKind === 'external_medical') {
      mapping.set(stableJson(source.reference), reference);
      continue;
    }
    const readSource = async (
      signal: AbortSignal,
    ): Promise<EvidenceSourceReadResult> => {
      if (signal.aborted) return { status: 'unavailable' };
      // A single memory or manual-history item cannot stand in for additional stored dependencies.
      const special = source.records.filter(
        record =>
          record.kind === 'reviewed_memory' || record.kind === 'manual_history',
      );
      if (
        !source.records.length ||
        (special.length > 0 && source.records.length !== 1) ||
        (reference.sourceKind === 'reviewed_memory') !==
          (special[0]?.kind === 'reviewed_memory')
      )
        return { status: 'unavailable' };
      const records = [];
      for (const descriptor of source.records) {
        if (descriptor.kind === 'reviewed_memory') {
          const memory = (await data.loadMemoryRecords()).find(
            item => item.id === descriptor.id,
          );
          if (!memory) return { status: 'missing' };
          if (
            fingerprint({ text: memory.text, meta: memory.meta }) !==
            descriptor.revision
          )
            return { status: 'changed' };
          return {
            status: 'available',
            document: { sourceKind: 'reviewed_memory', record: memory },
          };
        }
        if (descriptor.kind === 'manual_history')
          return readSavedManualHistorySource(descriptor, data.manualHistory);
        const record = await data.repository.readRecord(
          descriptor.kind,
          descriptor.id,
          signal,
        );
        if (!record) return { status: 'missing' };
        if (fingerprint(record) !== descriptor.revision)
          return { status: 'changed' };
        records.push({
          kind: descriptor.kind,
          record,
        } as import('../../healthEvidence/localEvidenceRepository').LocalHealthEvidenceRecord);
      }
      const stale = await data.loadStaleArtifacts(
        records.map(entry => ({ kind: entry.kind, id: entry.record.id })),
        signal,
      );
      if (stale.length) return { status: 'changed' };
      return signal.aborted
        ? { status: 'unavailable' }
        : {
            status: 'available',
            document: { sourceKind: 'personal_record', records },
          };
    };
    const sourceRead = await readSource(new AbortController().signal);
    sourceChanged ||= sourceRead.status !== 'available';
    // Reuse the selected result's revision reads; never preload history or regenerate stored prose.
    if (
      sourceRead.status === 'available' &&
      sourceRead.document.sourceKind === 'personal_record'
    )
      reviewEvidence.push({
        ...source.reference,
        content:
          'health_overview: ' +
          JSON.stringify({
            records: sourceRead.document.records.map(healthOverviewFacts),
          }),
      });
    if (
      sourceRead.status === 'available' &&
      sourceRead.document.sourceKind === 'manual_history'
    )
      reviewEvidence.push(
        manualHistorySummaryReviewEvidence(
          source.reference,
          sourceRead.document.evidence,
        ),
      );
    const current = registry.add({
      reference,
      content: '',
      readSource,
      validate: async signal =>
        (await readSource(signal)).status === 'available',
    });
    mapping.set(stableJson(source.reference), referenceOnly(current));
  }
  return { mapping, sourceChanged, reviewEvidence };
}
