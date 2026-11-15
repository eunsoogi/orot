import { t } from '../i18n';
import type { TranscriptEvidenceSegment } from '@orot/domain';
import type { TranscriptRecordingView } from '../transcription/transcriptEvidenceService';
import {
  shareRecordingAudio,
  shareRecordingTranscript,
  type RecordingExportResult,
} from './nativeRecordingBridge';

export interface RecordingExportService {
  shareAudio(recordingId: string): Promise<RecordingExportResult>;
  shareTranscript(text: string): Promise<RecordingExportResult>;
}

export const recordingExportService: RecordingExportService = {
  shareAudio: shareRecordingAudio,
  shareTranscript: shareRecordingTranscript,
};

export class EmptyRecordingTranscriptError extends Error {
  readonly code = 'RECORDING_EXPORT_TRANSCRIPT_EMPTY';

  constructor() {
    super('A transcript must exist before it can be exported.');
  }
}

function latestRevisions(
  segments: readonly TranscriptEvidenceSegment[],
): TranscriptEvidenceSegment[] {
  // Corrections append revisions, so export one current row per stable segment ID.
  const latest = new Map<string, TranscriptEvidenceSegment>();
  for (const segment of segments) {
    const current = latest.get(segment.transcriptId);
    if (!current || segment.revision > current.revision) {
      latest.set(segment.transcriptId, segment);
    }
  }
  return [...latest.values()].sort(
    (left, right) => left.segmentOrdinal - right.segmentOrdinal,
  );
}

function timestamp(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const fraction = total % 1000;
  const clock = [minutes, seconds]
    .map(value => String(value).padStart(2, '0'))
    .join(':');
  return `${hours > 0 ? `${String(hours).padStart(2, '0')}:` : ''}${clock}.${String(fraction).padStart(3, '0')}`;
}

function versionLabel(segment: TranscriptEvidenceSegment): string {
  return segment.provenance.origin === 'user_reported'
    ? t('recordingExport.corrected')
    : t('recordingExport.original');
}

/** Builds a plain-text export from the latest saved revision without rewriting source evidence. */
export function formatTranscriptExport(view: TranscriptRecordingView): string {
  const segments = latestRevisions(
    view.segments.filter(
      segment => segment.recordingSourceId === view.source.id,
    ),
  );
  if (segments.length === 0) {
    throw new EmptyRecordingTranscriptError();
  }

  const hasCorrection = segments.some(
    segment => segment.provenance.origin === 'user_reported',
  );
  const rows = segments.map(
    segment =>
      `[${timestamp(segment.audioRange.startMs)}–${timestamp(segment.audioRange.endMs)}] ${versionLabel(segment)}\n${segment.text}`,
  );
  return [
    t('recordingExport.title'),
    t('recordingExport.version', {
      version: hasCorrection
        ? t('recordingExport.includesCorrection')
        : t('recordingExport.original'),
    }),
    t('recordingExport.startedAt', { time: String(view.source.effectiveAt) }),
    '',
    ...rows,
    '',
  ].join('\n');
}
