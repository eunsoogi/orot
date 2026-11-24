import type { HealthObservation } from '@orot/domain';
import type { RecordRepository } from '@orot/storage';
import { healthRecordPeriodStart } from '../../healthkit/healthRecordsLibraryModel';
import { importedWorkoutUUID } from '../../healthkit/workoutHeartRate';

export const overviewWorkoutCandidateLimit = 20;

export type OverviewWorkoutCandidate = {
  readonly uuid: string;
  readonly record: HealthObservation;
};

export function workoutCandidate(
  record: HealthObservation,
): OverviewWorkoutCandidate | null {
  const uuid = importedWorkoutUUID(record);
  const start = Date.parse(record.effectiveAt);
  const end = Date.parse(record.endedAt ?? '');
  return uuid && Number.isFinite(start) && Number.isFinite(end) && end > start
    ? { uuid, record }
    : null;
}

/** One indexed workout-only page, never a general heart-rate query or fallback. */
export async function loadOverviewWorkoutCandidates(
  repository: Pick<RecordRepository, 'listHealthObservationPage'>,
  now: Date,
) {
  const toInclusive = now.toISOString();
  const fromInclusive = healthRecordPeriodStart(
    'month',
    toInclusive,
  )!.toISOString();
  const page = await repository.listHealthObservationPage(
    null,
    overviewWorkoutCandidateLimit,
    {
      category: 'workouts',
      fromInclusive,
      toInclusive,
    },
  );
  const from = Date.parse(fromInclusive);
  const candidates = page.records.flatMap(record => {
    const candidate = workoutCandidate(record);
    return candidate &&
      Date.parse(record.effectiveAt) >= from &&
      Date.parse(record.endedAt!) <= now.getTime()
      ? [candidate]
      : [];
  });
  return { candidates, hasMore: page.nextCursor !== null };
}

/** Exact source membership and saved presentation must survive the native await. */
export function sameWorkoutCandidate(
  candidate: OverviewWorkoutCandidate,
  record: HealthObservation | null,
) {
  if (!record || importedWorkoutUUID(record) !== candidate.uuid) return false;
  const previous = candidate.record;
  return (
    record.id === previous.id &&
    record.effectiveAt === previous.effectiveAt &&
    record.endedAt === previous.endedAt &&
    record.workout?.activityName === previous.workout?.activityName &&
    record.provenance.source?.sourceIdentifier ===
      previous.provenance.source?.sourceIdentifier &&
    record.provenance.source?.sourceName ===
      previous.provenance.source?.sourceName
  );
}
