import type { TranscriptEvidenceSegment } from '@orot/domain';
import { t } from '../i18n';

/** Review uses the latest revision of each segment; older text stays in its history. */
export function latestRevisions(
  segments: readonly TranscriptEvidenceSegment[],
): TranscriptEvidenceSegment[] {
  const latest = new Map<string, TranscriptEvidenceSegment>();
  for (const segment of segments) {
    const current = latest.get(segment.transcriptId);
    if (!current || segment.revision > current.revision)
      latest.set(segment.transcriptId, segment);
  }
  return [...latest.values()].sort(
    (left, right) => left.segmentOrdinal - right.segmentOrdinal,
  );
}

export type TranscriptError = 'load' | 'create' | 'correct' | 'play';

/** Only localized operation labels reach the UI; native errors may contain private paths. */
export function errorLabel(error: TranscriptError): string {
  return t(`recording.transcript.error.${error}`);
}
