import type { EvidenceReference, EvidenceItem } from '@orot/agent-runtime';
import type { DiseaseHypothesisAnalysis } from '../../diseaseHypotheses/types';
import type {
  SavedSummarySource,
  SavedSymptomSummary,
} from '../../diseaseHypotheses/savedSummaries';
import type { AiFeatureLocalData } from './localData';
import type { EvidenceSourceReadResult } from './evidenceRegistry';
import { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { fingerprint } from './evidenceUtils';
import { referenceOnly } from '../../diseaseHypotheses/resultValidation';
import { summaryFactIssue } from '../../diseaseHypotheses/summaryFactValidation';
import { healthOverviewFacts } from './healthOverviewFacts';
import {
  isPeriodSummarySource,
  type SavedRecordSummarySource,
} from '../../diseaseHypotheses/savedSummaries';
import { healthContextRevision } from '../../healthEvidence/healthContext/scope';
import {
  healthContextContent,
  registerHealthContextEvidence,
} from './healthContextEvidence';

function references(analysis: DiseaseHypothesisAnalysis) {
  return [
    ...new Map(
      analysis.hypotheses
        .flatMap(item => [...item.supportingEvidence, ...item.contraryEvidence])
        .map(ref => [JSON.stringify(ref), ref]),
    ).values(),
  ];
}
function mapAnalysis(
  analysis: DiseaseHypothesisAnalysis,
  map: (ref: EvidenceReference) => EvidenceReference,
): DiseaseHypothesisAnalysis {
  return {
    presentation: 'symptom_summary',
    hypotheses: analysis.hypotheses.map(item => ({
      ...item,
      supportingEvidence: item.supportingEvidence.map(map),
      contraryEvidence: item.contraryEvidence.map(map),
    })),
  };
}
/** Persist storage identities, never turn-local e1/s1 aliases that can refer to different rows after restart. */
export async function captureSymptomSummarySources(
  analysis: DiseaseHypothesisAnalysis,
  registry: LocalEvidenceReferenceRegistry,
  signal: AbortSignal,
) {
  const mapping = new Map<string, EvidenceReference>();
  const sources: SavedSummarySource[] = [];
  for (const ref of references(analysis)) {
    if (signal.aborted) throw new Error('Saving was cancelled.');
    if (ref.sourceKind === 'external_medical') {
      sources.push({ reference: ref, records: [] });
      mapping.set(JSON.stringify(ref), ref);
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
      mapping.set(JSON.stringify(ref), original);
      continue;
    }
    const records: SavedRecordSummarySource['records'] =
      read.document.sourceKind === 'personal_record'
        ? read.document.records.map(entry => ({
            kind: entry.kind,
            id: entry.record.id,
            revision: fingerprint(entry.record),
          }))
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
    mapping.set(JSON.stringify(ref), original);
  }
  return {
    analysis: mapAnalysis(analysis, ref => mapping.get(JSON.stringify(ref))!),
    sources,
  };
}

/** Restores exact source reads; changed or deleted records never silently become a historical citation. */
export async function restoreSymptomSummary(
  saved: SavedSymptomSummary,
  registry: LocalEvidenceReferenceRegistry,
  data: AiFeatureLocalData,
): Promise<DiseaseHypothesisAnalysis> {
  const mapping = new Map<string, EvidenceReference>();
  let sourceChanged = false;
  const reviewEvidence: EvidenceItem[] = [];
  for (const source of saved.sources) {
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
              original: source.reference,
              expectedRevision: source.revision,
            })
          : registry.add({
              reference: source.reference,
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
      mapping.set(JSON.stringify(source.reference), referenceOnly(current));
      continue;
    }
    if (source.reference.sourceKind === 'external_medical') {
      mapping.set(JSON.stringify(source.reference), source.reference);
      continue;
    }
    const readSource = async (
      signal: AbortSignal,
    ): Promise<EvidenceSourceReadResult> => {
      if (signal.aborted) return { status: 'unavailable' };
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
    const current = registry.add({
      reference: source.reference,
      content: '',
      readSource,
      validate: async signal =>
        (await readSource(signal)).status === 'available',
    });
    mapping.set(JSON.stringify(source.reference), referenceOnly(current));
  }
  const contentReviewIssues = [
    ...new Set(
      saved.analysis.hypotheses.flatMap(section => {
        const issue = summaryFactIssue(
          { hypotheses: [section] },
          reviewEvidence,
        );
        return issue === 'prescription' ||
          issue === 'sleep_count' ||
          issue === 'sleep_duration' ||
          issue === 'step_unit'
          ? [issue]
          : [];
      }),
    ),
  ];
  return {
    ...mapAnalysis(saved.analysis, ref => mapping.get(JSON.stringify(ref))!),
    savedSummary: {
      status: 'saved',
      id: saved.id,
      createdAt: saved.createdAt,
      modelName: saved.modelName,
      sourceChanged,
      ...(contentReviewIssues.length ? { contentReviewIssues } : {}),
    },
  };
}
