import { isCalendarClassificationWitness } from '@orot/storage';
import type { CalendarEvent } from '../calendar/types';
import type { ClassificationRunResult } from './classificationWorkflow';

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
  const failure = result.failure?.status;
  return (
    failure === 'invalid_output' ||
    failure === 'incomplete_result' ||
    failure === 'budget_exceeded'
  );
}
