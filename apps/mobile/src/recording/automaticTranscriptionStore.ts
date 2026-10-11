import type { TranscriptEvidenceService } from '../transcription/transcriptEvidenceService';
import { TranscriptRecognitionError } from '../transcription/TranscriptRecognitionError';
import type { AutomaticTranscriptionSnapshot } from './useAutomaticRecordingTranscription';

interface Job {
  readonly controller: AbortController;
  promise: Promise<void>;
}

function createStore(service?: TranscriptEvidenceService) {
  let snapshot: AutomaticTranscriptionSnapshot | null = null;
  const listeners = new Set<() => void>();
  const jobs = new Map<string, Job>();
  const publish = (next: AutomaticTranscriptionSnapshot | null) => {
    snapshot = next;
    listeners.forEach(listener => listener());
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start(sourceId: string): Promise<void> {
      if (!service) return Promise.resolve();
      const active = jobs.get(sourceId);
      if (active) return active.promise;
      const job: Job = {
        controller: new AbortController(),
        promise: Promise.resolve(),
      };
      jobs.set(sourceId, job);
      publish({ sourceId, status: 'running' });
      job.promise = Promise.resolve()
        .then(() => service.transcribe(sourceId, job.controller.signal))
        .then(
          () => {
            if (
              jobs.get(sourceId) === job &&
              !job.controller.signal.aborted &&
              snapshot?.sourceId === sourceId
            ) {
              publish({ sourceId, status: 'complete' });
            }
          },
          error => {
            if (
              jobs.get(sourceId) === job &&
              !job.controller.signal.aborted &&
              snapshot?.sourceId === sourceId
            ) {
              publish({
                sourceId,
                status: 'failed',
                ...(error instanceof TranscriptRecognitionError
                  ? { failureReason: error.reason }
                  : {}),
              });
            }
          },
        )
        .finally(() => {
          if (jobs.get(sourceId) === job) jobs.delete(sourceId);
        });
      return job.promise;
    },
    cancel(sourceId: string) {
      jobs.get(sourceId)?.controller.abort();
      jobs.delete(sourceId);
      if (snapshot?.sourceId === sourceId) publish(null);
    },
    reset() {
      if (!snapshot || !jobs.has(snapshot.sourceId)) publish(null);
    },
  };
}

// Service ownership outlives navigation. Process termination still requires an explicit retry.
const stores = new WeakMap<
  TranscriptEvidenceService,
  ReturnType<typeof createStore>
>();
const unavailable = createStore();
export function getAutomaticTranscriptionStore(
  service?: TranscriptEvidenceService,
) {
  if (!service) return unavailable;
  let store = stores.get(service);
  if (!store) {
    store = createStore(service);
    stores.set(service, store);
  }
  return store;
}
