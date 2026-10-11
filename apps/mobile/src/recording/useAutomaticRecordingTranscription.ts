import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranscriptEvidenceService } from '../transcription/transcriptEvidenceService';

export interface AutomaticTranscriptionSnapshot {
  readonly sourceId: string;
  readonly status: 'running' | 'failed' | 'complete';
}

interface TranscriptionJob {
  readonly controller: AbortController;
  promise: Promise<void>;
}

/** Runs one local transcript job per recording and ignores stale UI completions. */
export function useAutomaticRecordingTranscription(
  service?: TranscriptEvidenceService,
) {
  const [state, setState] = useState<AutomaticTranscriptionSnapshot | null>(
    null,
  );
  const jobs = useRef(new Map<string, TranscriptionJob>());
  const currentJob = useRef<TranscriptionJob | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const start = useCallback(
    (sourceId: string): Promise<void> => {
      if (!service) return Promise.resolve();
      const pending = jobs.current.get(sourceId);
      if (pending) return pending.promise;

      const controller = new AbortController();
      const job: TranscriptionJob = {
        controller,
        promise: Promise.resolve(),
      };
      const promise = Promise.resolve()
        .then(() => service.transcribe(sourceId, controller.signal))
        .then(
          () => {
            if (mounted.current && currentJob.current === job) {
              setState({ sourceId, status: 'complete' });
            }
          },
          () => {
            if (
              mounted.current &&
              currentJob.current === job &&
              !controller.signal.aborted
            ) {
              setState({ sourceId, status: 'failed' });
            }
          },
        )
        .finally(() => {
          if (jobs.current.get(sourceId) === job) jobs.current.delete(sourceId);
          if (currentJob.current === job) currentJob.current = null;
        });
      // Keep one stable identity across completion handlers and the in-flight map.
      job.promise = promise;
      jobs.current.set(sourceId, job);
      currentJob.current = job;
      setState({ sourceId, status: 'running' });
      return promise;
    },
    [service],
  );

  const cancel = useCallback(
    (sourceId: string) => {
      const pending = jobs.current.get(sourceId);
      if (pending) {
        pending.controller.abort();
        jobs.current.delete(sourceId);
      }
      if (currentJob.current === pending || state?.sourceId === sourceId) {
        currentJob.current = null;
        setState(null);
      }
    },
    [state?.sourceId],
  );

  const reset = useCallback(() => {
    if (!currentJob.current) setState(null);
  }, []);

  return { cancel, reset, start, state };
}
