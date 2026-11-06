import type { RecordingSnapshot } from './recordingTypes';

/** Capture starts without implying microphone or recording consent. */
export const initialRecordingSnapshot: RecordingSnapshot = {
  status: 'idle',
  id: null,
  durationMs: 0,
  consentAcknowledged: false,
};
