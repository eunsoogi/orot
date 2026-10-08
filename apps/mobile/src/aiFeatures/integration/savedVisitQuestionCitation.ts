import type { EvidenceItem } from '@orot/agent-runtime';
import type { RecordRepository } from '@orot/storage';
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
  const source = await input.records.sourceRecords.get(span.sourceRecordId);
  if (!source)
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
  const sourceFingerprint = fingerprint(source);
  const reference = {
    sourceKind: 'personal_record' as const,
    sourceId: source.id,
    sourceRevision: sourceFingerprint,
    evidenceId: span.id,
    evidenceRevision: spanFingerprint,
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
      const [currentSpan, currentSource] = await Promise.all([
        input.records.evidenceSpans.get(span.id),
        input.records.sourceRecords.get(source.id),
      ]);
      return (
        !signal.aborted &&
        currentSpan !== null &&
        currentSource !== null &&
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
