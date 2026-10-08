import type { EvidenceItem } from '@orot/agent-runtime';
import type { RecordRepository } from '@orot/storage';
import { localEvidenceFingerprint } from '../../agent/visitQuestions/evidence';
import type { LocalHealthEvidenceRepository } from '../../healthEvidence/localEvidenceRepository';
import { fingerprint } from './evidenceUtils';
import type { EvidenceSourceReadResult } from './evidenceRegistry';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { isCurrentTranscriptArtifactStale } from './transcriptInvalidations';

export class SavedVisitQuestionsReadError extends Error {
  readonly reason:
    'invalid_question' | 'missing_citation_source' | 'stale_artifact';

  constructor(
    reason: 'invalid_question' | 'missing_citation_source' | 'stale_artifact',
  ) {
    super(
      reason === 'invalid_question'
        ? 'A saved visit question is incomplete.'
        : reason === 'missing_citation_source'
          ? 'A saved visit question no longer has its cited source.'
          : 'A saved visit question relies on a corrected transcript.',
    );
    this.name = 'SavedVisitQuestionsReadError';
    this.reason = reason;
  }
}

function referenceReviewState(status: string): EvidenceItem['reviewState'] {
  if (status === 'reviewed') return 'reviewed';
  if (status === 'unreviewed') return 'unreviewed';
  return 'unknown';
}

/** Hashes linked SourceRecord revisions; transcript lineage is fenced by stale-artifact rows. */
async function linkedSourceRevision(
  records: RecordRepository,
  sourceRecordIds: readonly string[],
): Promise<string | null> {
  const linkedInputs = await Promise.all(
    sourceRecordIds.map(async id => {
      const source = await records.sourceRecords.get(id);
      if (source) return { kind: 'source' as const, id, source };
      // Transcript revisions are a separate record kind and use explicit invalidation rows.
      const transcript = await records.get('transcript_segment', id);
      return transcript
        ? { kind: 'transcript' as const, id }
        : { kind: 'missing' as const, id };
    }),
  );
  const revisions: { sourceId: string; revision: string }[] = [];
  for (const input of linkedInputs) {
    if (input.kind === 'missing') return null;
    if (input.kind === 'source') {
      revisions.push({
        sourceId: input.id,
        revision: localEvidenceFingerprint(input.source),
      });
    }
  }
  return localEvidenceFingerprint(revisions);
}

/** Registers saved source links while checking transcript invalidations around each read. */
export async function registerSavedCitation(input: {
  readonly spanId: string;
  readonly records: RecordRepository;
  readonly sourceReader: LocalHealthEvidenceRepository;
  readonly registry: LocalEvidenceReferenceRegistry;
}): Promise<EvidenceItem> {
  if (
    await isCurrentTranscriptArtifactStale(
      input.records,
      'evidence_span',
      input.spanId,
    )
  ) {
    throw new SavedVisitQuestionsReadError('stale_artifact');
  }
  const span = await input.records.evidenceSpans.get(input.spanId);
  if (!span) throw new SavedVisitQuestionsReadError('missing_citation_source');
  const sourceRecordIds = [...new Set(span.provenance.sourceRecordIds)];
  const [source, sourceRevision] = await Promise.all([
    input.records.sourceRecords.get(span.sourceRecordId),
    linkedSourceRevision(input.records, sourceRecordIds),
  ]);
  if (!source || sourceRevision === null)
    throw new SavedVisitQuestionsReadError('missing_citation_source');
  if (
    await isCurrentTranscriptArtifactStale(
      input.records,
      'evidence_span',
      span.id,
    )
  ) {
    throw new SavedVisitQuestionsReadError('stale_artifact');
  }
  const spanFingerprint = fingerprint(span);
  const evidenceRevision = localEvidenceFingerprint(span);
  const sourceFingerprint = fingerprint(source);
  const reference = {
    sourceKind: 'personal_record' as const,
    sourceId: source.id,
    sourceRevision,
    evidenceId: span.id,
    evidenceRevision,
    locator: span.locator ?? { kind: 'evidence_span', evidenceSpanId: span.id },
    effectiveTime: span.effectiveAt,
    reviewState: referenceReviewState(span.reviewState.status),
  };

  return input.registry.add({
    reference,
    content: span.text,
    async validate(signal) {
      if (
        signal.aborted ||
        (await isCurrentTranscriptArtifactStale(
          input.records,
          'evidence_span',
          span.id,
        ))
      ) {
        return false;
      }
      const [currentSpan, currentSource, currentSourceRevision] =
        await Promise.all([
          input.records.evidenceSpans.get(span.id),
          input.records.sourceRecords.get(source.id),
          linkedSourceRevision(input.records, sourceRecordIds),
        ]);
      return (
        !signal.aborted &&
        currentSpan !== null &&
        currentSource !== null &&
        currentSourceRevision === sourceRevision &&
        fingerprint(currentSpan) === spanFingerprint &&
        fingerprint(currentSource) === sourceFingerprint &&
        !(await isCurrentTranscriptArtifactStale(
          input.records,
          'evidence_span',
          span.id,
        ))
      );
    },
    async readSource(signal): Promise<EvidenceSourceReadResult> {
      if (signal.aborted) return { status: 'unavailable' };
      if (
        await isCurrentTranscriptArtifactStale(
          input.records,
          'evidence_span',
          span.id,
        )
      ) {
        return { status: 'changed' };
      }
      // Corrections append invalidation rows separately, so recheck after loading the source document.
      const result = await input.sourceReader.querySource(source.id, {
        signal,
      });
      if (signal.aborted) return { status: 'unavailable' };
      if (
        await isCurrentTranscriptArtifactStale(
          input.records,
          'evidence_span',
          span.id,
        )
      ) {
        return { status: 'changed' };
      }
      if (result.status === 'source_missing') return { status: 'missing' };
      if (!result.complete) return { status: 'unavailable' };
      return {
        status: 'available',
        document: { sourceKind: 'personal_record', records: result.records },
      };
    },
  });
}
