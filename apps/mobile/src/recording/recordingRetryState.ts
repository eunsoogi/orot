import type { CompletedRecording, RecordingService } from './recordingTypes';

const pendingRetries = new WeakMap<RecordingService, CompletedRecording>();

export function getPendingRecordingRetry(
  service: RecordingService,
): CompletedRecording | null {
  return pendingRetries.get(service) ?? null;
}

export function setPendingRecordingRetry(
  service: RecordingService,
  recording: CompletedRecording,
): void {
  pendingRetries.set(service, recording);
}

export function clearPendingRecordingRetry(service: RecordingService): void {
  pendingRetries.delete(service);
}
