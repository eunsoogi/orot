import type {
  HealthObservationCursor,
  HealthObservationPage,
} from '@orot/storage';
import { healthRecordPeriodStart } from './healthRecordsLibraryModel';
import type { HealthRecordsDetailSelection } from './healthRecordsLibraryModel';

/** Reads the entire bounded period so the chart and detail count describe the same data. */
export async function loadHealthObservationPeriod(
  load: (
    cursor: HealthObservationCursor | null,
  ) => Promise<HealthObservationPage>,
  period: HealthRecordsDetailSelection['period'],
  now: string,
): Promise<HealthObservationPage> {
  const cutoff = healthRecordPeriodStart(period, now);
  const first = await load(null);
  // All-time history remains paged because it has no bounded date window.
  if (!cutoff || !first.nextCursor) return first;
  const records = [...first.records];
  let nextCursor: HealthObservationCursor | null = first.nextCursor;
  while (nextCursor) {
    const cursorTime = new Date(nextCursor.effectiveAt).getTime();
    if (Number.isFinite(cursorTime) && cursorTime < cutoff.getTime()) break;
    const previous: HealthObservationCursor = nextCursor;
    const page = await load(previous);
    records.push(...page.records);
    if (
      page.nextCursor &&
      page.nextCursor.id === previous.id &&
      page.nextCursor.effectiveAt === previous.effectiveAt
    ) {
      // A stalled storage cursor must become an error instead of keeping the screen loading forever.
      throw new Error('Health observation paging did not advance.');
    }
    nextCursor = page.nextCursor;
  }
  return { records, nextCursor };
}
