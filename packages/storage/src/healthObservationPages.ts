import type { HealthObservation } from '@orot/domain';
import { decodeStoredRecord } from './recordPersistence';
import type { SqlExecutor } from './sql';

export interface HealthObservationCursor {
  readonly effectiveAt: string;
  readonly id: string;
}
export interface HealthObservationPage {
  readonly records: readonly HealthObservation[];
  readonly nextCursor: HealthObservationCursor | null;
}

/** Bounds decoding to one page; IDs break timestamp ties without skipping equal-time samples. */
export async function readHealthObservationPage(
  executor: SqlExecutor,
  cursor: HealthObservationCursor | null = null,
  limit = 50,
): Promise<HealthObservationPage> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Health observation page size must be between 1 and 100.');
  }
  const result = await executor.execute(
    'SELECT payload_json FROM health_observations ' +
      (cursor ? 'WHERE effective_at < ? OR (effective_at = ? AND id > ?) ' : '') +
      'ORDER BY effective_at DESC, id ASC LIMIT ?',
    cursor ? [cursor.effectiveAt, cursor.effectiveAt, cursor.id, limit + 1] : [limit + 1],
  );
  const records = result.rows
    .slice(0, limit)
    .map((row) => decodeStoredRecord('health_observation', row.payload_json));
  const last = records[records.length - 1];
  return {
    records,
    nextCursor:
      result.rows.length > limit && last ? { effectiveAt: last.effectiveAt, id: last.id } : null,
  };
}
