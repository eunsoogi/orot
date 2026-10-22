import type { TranscriptEvidenceSegment } from '@orot/domain';
import { t } from '../i18n';
import { TranscriptRecognitionError } from './TranscriptRecognitionError';

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

export type TranscriptError =
  | 'load'
  | 'create'
  | 'correct'
  | 'play'
  | 'permission'
  | 'model'
  | 'unsupported'
  | 'timeout'
  | 'noSpeech'
  | 'missing';

/** Retain a closed recovery category, never provider messages or protected file paths. */
export function transcriptionCreationError(error: unknown): TranscriptError {
  if (!(error instanceof TranscriptRecognitionError)) return 'create';
  const reason = error.reason;
  if (reason.startsWith('PERMISSION_')) return 'permission';
  if (reason === 'MODEL_UNAVAILABLE') return 'model';
  if (reason === 'UNSUPPORTED_DEVICE' || reason === 'UNSUPPORTED_LANGUAGE')
    return 'unsupported';
  if (reason === 'TRANSCRIPTION_TIMEOUT') return 'timeout';
  if (reason === 'NO_RECOGNIZED_SPEECH') return 'noSpeech';
  if (reason === 'RECORDING_FILE_MISSING') return 'missing';
  return 'create';
}

/** Only localized operation labels reach the UI; native errors may contain private paths. */
export function errorLabel(error: TranscriptError): string {
  switch (error) {
    case 'permission':
      return t('recording.transcript.permissionHelp');
    case 'model':
      return t('recording.transcript.modelHelp');
    case 'unsupported':
      return t('recording.transcript.unsupportedHelp');
    case 'timeout':
      return t('recording.transcript.timeoutHelp');
    case 'noSpeech':
      return t('recording.transcript.noSpeechHelp');
    case 'missing':
      return t('recording.library.playbackMissing');
  }
  return t(`recording.transcript.error.${error}`);
}
