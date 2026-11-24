import { RecordIdSchema, TimestampSchema } from '@orot/domain';
import type { SqlExecutor, SqlValue } from './sql';
import { localQueryTimestampKey, localQueryTimestampKeyExpression } from './localQueryTimestamp';
import type { HealthObservationCursor } from './healthObservationPages';
import {
  appleDerivedHeartRateCategories,
  appleDerivedHeartRatePredicate,
  isAppleDerivedHeartRateCategory,
} from './appleDerivedHeartRate';

export const HEALTH_OBSERVATION_PAGE_CATEGORIES = [
  'blood_pressure',
  'heart_rate',
  ...appleDerivedHeartRateCategories,
  'steps',
  'body_mass',
  'workouts',
  'sleep',
  'other',
] as const;
export type HealthObservationPageCategory = (typeof HEALTH_OBSERVATION_PAGE_CATEGORIES)[number];

export interface HealthObservationPageFilter {
  readonly category: HealthObservationPageCategory;
  readonly fromInclusive?: string;
  readonly toInclusive: string;
  /** Workouts match their actual end and a half-open upper start bound instead of start alone. */
  readonly matchWorkoutOverlap?: true;
}

// The same fixed expression is used by the index and every scoped reader.
// Indexing the category avoids scanning dense Watch samples to find sparse types.
const concept = "json_extract(payload_json, '$.concept')";
const categoryExpression = `CASE
  WHEN ${concept} IN ('blood pressure systolic', 'blood pressure diastolic') THEN 'blood_pressure'
  WHEN ${concept} = 'heart_rate' THEN 'heart_rate'
  WHEN ${concept} = 'workout_duration' THEN 'workouts'
  WHEN ${concept} = 'step_count' THEN 'steps'
  WHEN ${concept} = 'body_mass' THEN 'body_mass'
  WHEN ${concept} = 'HKCategoryTypeIdentifierSleepAnalysis' THEN 'sleep'
  ELSE 'other' END`;
const timeExpression = localQueryTimestampKeyExpression('effective_at');
const endedAt = "json_extract(payload_json, '$.endedAt')";
const endTimeExpression = localQueryTimestampKeyExpression(endedAt);

/** Added once during schema migration; existing rows and source times remain unchanged. */
export async function createHealthObservationLibraryIndex(executor: SqlExecutor): Promise<void> {
  await executor.execute(`CREATE INDEX IF NOT EXISTS health_observations_library_workouts_idx
    ON health_observations ((${categoryExpression}), (${timeExpression}) DESC, id ASC)`);
}

/** Builds an indexed type/period page without losing offset or sub-millisecond ordering. */
export function healthObservationPagePredicate(
  filter: HealthObservationPageFilter,
  cursor: HealthObservationCursor | null,
): { where: string; parameters: SqlValue[]; order: string } {
  const scope = healthObservationCategoryScope(filter.category);
  const to = localQueryTimestampKey(TimestampSchema.parse(filter.toInclusive));
  const from =
    filter.fromInclusive === undefined
      ? null
      : localQueryTimestampKey(TimestampSchema.parse(filter.fromInclusive));
  if (from !== null && from > to) throw new Error('Health observation period is invalid.');
  const category = filter.category;
  const overlap = filter.matchWorkoutOverlap === true;
  if (overlap && (category !== 'workouts' || from === null || from >= to)) {
    throw new Error('Workout overlap period is invalid.');
  }
  const clauses = [scope.where, `(${timeExpression}) ${overlap ? '<' : '<='} ?`];
  const parameters: SqlValue[] = [...scope.parameters, to];
  if (from !== null) {
    // Do not gate the workout cohort by start alone: a genuine workout may cross from.
    clauses.push(
      overlap
        ? `(${endedAt}) IS NOT NULL AND (${endTimeExpression}) > ?`
        : `(${timeExpression}) >= ?`,
    );
    parameters.push(from);
  }
  if (cursor) {
    const key = localQueryTimestampKey(TimestampSchema.parse(cursor.effectiveAt));
    RecordIdSchema.parse(cursor.id);
    // The outer range lets SQLite seek to the cursor instead of rescanning
    // earlier pages; IDs retain stable ordering among equal source instants.
    clauses.push(`(${timeExpression}) <= ? AND ((${timeExpression}) < ? OR id > ?)`);
    parameters.push(key, key, cursor.id);
  }
  return { where: clauses.join(' AND '), parameters, order: `(${timeExpression}) DESC, id ASC` };
}

/** Indexed category admission shared by ordinary paging and per-day windows. */
export function healthObservationCategoryScope(category: HealthObservationPageCategory) {
  if (!HEALTH_OBSERVATION_PAGE_CATEGORIES.includes(category))
    throw new Error('Health observation category is invalid.');
  if (isAppleDerivedHeartRateCategory(category))
    return { where: appleDerivedHeartRatePredicate(category), parameters: [] as SqlValue[] };
  const admitted = `(${categoryExpression}) = ?`;
  if (category !== 'other') return { where: admitted, parameters: [category] };
  const derived = appleDerivedHeartRateCategories
    .map((item) => `(${appleDerivedHeartRatePredicate(item)})`)
    .join(' OR ');
  return { where: admitted + ` AND NOT COALESCE((${derived}), 0)`, parameters: [category] };
}
