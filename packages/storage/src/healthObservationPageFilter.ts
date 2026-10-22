import { RecordIdSchema, TimestampSchema } from '@orot/domain';
import type { SqlExecutor, SqlValue } from './sql';
import { localQueryTimestampKey, localQueryTimestampKeyExpression } from './localQueryTimestamp';
import type { HealthObservationCursor } from './healthObservationPages';

export const HEALTH_OBSERVATION_PAGE_CATEGORIES = [
  'blood_pressure',
  'heart_rate',
  'steps',
  'body_mass',
  'sleep',
  'other',
] as const;
export type HealthObservationPageCategory = (typeof HEALTH_OBSERVATION_PAGE_CATEGORIES)[number];

export interface HealthObservationPageFilter {
  readonly category: HealthObservationPageCategory;
  readonly fromInclusive?: string;
  readonly toInclusive: string;
}

// The same fixed expression is used by the index and every scoped reader.
// Indexing the category avoids scanning dense Watch samples to find sparse types.
const concept = "json_extract(payload_json, '$.concept')";
const categoryExpression = `CASE
  WHEN ${concept} IN ('blood pressure systolic', 'blood pressure diastolic') THEN 'blood_pressure'
  WHEN ${concept} = 'heart_rate' THEN 'heart_rate'
  WHEN ${concept} = 'step_count' THEN 'steps'
  WHEN ${concept} = 'body_mass' THEN 'body_mass'
  WHEN ${concept} = 'HKCategoryTypeIdentifierSleepAnalysis' THEN 'sleep'
  ELSE 'other' END`;
const timeExpression = localQueryTimestampKeyExpression('effective_at');

/** Added once during schema migration; existing rows and source times remain unchanged. */
export async function createHealthObservationLibraryIndex(executor: SqlExecutor): Promise<void> {
  await executor.execute(`CREATE INDEX IF NOT EXISTS health_observations_library_idx
    ON health_observations ((${categoryExpression}), (${timeExpression}) DESC, id ASC)`);
}

/** Builds an indexed type/period page without losing offset or sub-millisecond ordering. */
export function healthObservationPagePredicate(
  filter: HealthObservationPageFilter,
  cursor: HealthObservationCursor | null,
): { where: string; parameters: SqlValue[]; order: string } {
  if (!HEALTH_OBSERVATION_PAGE_CATEGORIES.includes(filter.category)) {
    throw new Error('Health observation category is invalid.');
  }
  const to = localQueryTimestampKey(TimestampSchema.parse(filter.toInclusive));
  const from =
    filter.fromInclusive === undefined
      ? null
      : localQueryTimestampKey(TimestampSchema.parse(filter.fromInclusive));
  if (from !== null && from > to) throw new Error('Health observation period is invalid.');
  const clauses = [`(${categoryExpression}) = ?`, `(${timeExpression}) <= ?`];
  const parameters: SqlValue[] = [filter.category, to];
  if (from !== null) {
    clauses.push(`(${timeExpression}) >= ?`);
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
