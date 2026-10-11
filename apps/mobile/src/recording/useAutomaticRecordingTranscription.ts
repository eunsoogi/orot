import { useSyncExternalStore } from 'react';
import type { TranscriptEvidenceService } from '../transcription/transcriptEvidenceService';
import { getAutomaticTranscriptionStore } from './automaticTranscriptionStore';

export interface AutomaticTranscriptionSnapshot {
  readonly sourceId: string;
  readonly status: 'running' | 'failed' | 'complete';
  readonly failureReason?: string;
}

/** Route subscriptions can disappear without losing a saved recording's active job. */
export function useAutomaticRecordingTranscription(
  service?: TranscriptEvidenceService,
) {
  const store = getAutomaticTranscriptionStore(service);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return {
    start: store.start,
    cancel: store.cancel,
    reset: store.reset,
    state,
  };
}
