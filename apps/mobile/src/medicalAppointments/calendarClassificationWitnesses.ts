import { isCalendarClassificationWitness } from '@orot/storage';
import type { CalendarEvent } from '../calendar/types';
import type { ClassificationRunResult } from './classificationWorkflow';
import { createClassificationCandidates } from './classificationCandidates';

/** Never create a reuse key for an ambiguous native occurrence or a competing snapshot. */
export function exactKeys(events: readonly CalendarEvent[]) {
  const keys = events.map(event =>
    isCalendarClassificationWitness(event.classificationWitness)
      ? event.classificationWitness
      : undefined,
  );
  const counts = new Map<string, number>();
  for (const key of keys)
    if (key) counts.set(key.occurrence, (counts.get(key.occurrence) ?? 0) + 1);
  return keys.map(key =>
    key && counts.get(key.occurrence) === 1 ? key : undefined,
  );
}

/** Save only independently final batches, never after consent/source loss or ambiguous errors. */
export function canStoreClassifiedCalendarBatches(
  result: ClassificationRunResult,
) {
  if (result.status === 'complete') return true;
  if (result.status !== 'partial' || result.completedBatches < 1) return false;
  const failure = result.failure;
  return (
    failure?.status === 'invalid_output' ||
    failure?.status === 'incomplete_result' ||
    failure?.status === 'budget_exceeded' ||
    // Rate limiting a subsequent batch never invalidated the already validated
    // verdicts. Persist only those after the caller rechecks source and ownership.
    (failure?.status === 'unavailable' &&
      failure.providerErrorCode === 'rate_limited')
  );
}

/** Unknown native identity is a local review outcome, never a cache hit or an AI miss. */
export function reviewExactCalendarCandidates(
  events: readonly CalendarEvent[],
) {
  const keys = exactKeys(events);
  const candidates = createClassificationCandidates(events).map(
    (candidate, index) =>
      keys[index]
        ? candidate
        : { ...candidate, unresolvedCalendarIdentity: true as const },
  );
  return { keys, candidates };
}
