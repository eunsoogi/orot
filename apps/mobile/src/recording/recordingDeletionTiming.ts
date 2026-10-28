import { createContext } from 'react';
import type { RecordingDeletionTrace } from './recordingDeletionTrace';

export type RecordingDeletionTimingMark =
  | 'confirmation-tap'
  | 'progress-presented'
  | 'list-refresh'
  | 'list-summary-refresh';

export type RecordingDeletionTimingSpan =
  | 'source-read'
  | 'stop-check'
  | 'audio-staging'
  | 'memory-open'
  | 'derived-data-cleanup'
  | 'database-delete-commit'
  | 'audio-cleanup'
  | 'list-summary-read';

export type RecordingDeletionTimingOutcome = 'success' | 'failure';

/** The opt-in observer records only deletion stage names and monotonic elapsed time. */
export interface RecordingDeletionTimingProbe {
  readonly trace?: RecordingDeletionTrace;
  mark(stage: RecordingDeletionTimingMark): void;
  begin(stage: RecordingDeletionTimingSpan): void;
  end(
    stage: RecordingDeletionTimingSpan,
    outcome: RecordingDeletionTimingOutcome,
  ): void;
  finish(outcome: RecordingDeletionTimingOutcome): void;
}

/** A diagnostic observer must never interrupt a user's recording deletion. */
function observe(callback: () => void): void {
  try {
    callback();
  } catch {
    // Timing is auxiliary; an observer failure cannot change deletion behavior.
  }
}

export function markRecordingDeletionTiming(
  probe: RecordingDeletionTimingProbe | undefined,
  stage: RecordingDeletionTimingMark,
): void {
  if (probe) observe(() => probe.mark(stage));
}

export function finishRecordingDeletionTiming(
  probe: RecordingDeletionTimingProbe | undefined,
  outcome: RecordingDeletionTimingOutcome,
): void {
  if (probe) observe(() => probe.finish(outcome));
}

export function beginRecordingDeletionTiming(
  probe: RecordingDeletionTimingProbe | undefined,
  stage: RecordingDeletionTimingSpan,
): void {
  if (probe) observe(() => probe.begin(stage));
}

export function endRecordingDeletionTiming(
  probe: RecordingDeletionTimingProbe | undefined,
  stage: RecordingDeletionTimingSpan,
  outcome: RecordingDeletionTimingOutcome,
): void {
  if (probe) observe(() => probe.end(stage, outcome));
}

/** Times one asynchronous stage while preserving its value and original error. */
export function withRecordingDeletionTiming<T>(
  probe: RecordingDeletionTimingProbe | undefined,
  stage: RecordingDeletionTimingSpan,
  operation: () => Promise<T>,
): Promise<T> {
  if (!probe) return operation();
  beginRecordingDeletionTiming(probe, stage);

  let result: Promise<T>;
  try {
    result = operation();
  } catch (error) {
    endRecordingDeletionTiming(probe, stage, 'failure');
    return Promise.reject(error);
  }

  return result.then(
    value => {
      endRecordingDeletionTiming(probe, stage, 'success');
      return value;
    },
    error => {
      endRecordingDeletionTiming(probe, stage, 'failure');
      throw error;
    },
  );
}

/** Only an explicit Simulator measurement harness supplies the opt-in observer. */
export const RecordingDeletionTimingContext =
  createContext<RecordingDeletionTimingProbe | null>(null);
