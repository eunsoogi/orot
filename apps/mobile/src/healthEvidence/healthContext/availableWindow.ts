import { recentHealthContextWindow } from './window';
import { compareTimestamps, TimestampSchema } from '@orot/domain';
import {
  localQueryTimestampKey,
  localQueryTimestampKeyExpression,
} from '@orot/storage';
import type { SqlExecutor, RecordKind } from '@orot/storage';
import { currentEvidenceCondition } from '../evidenceCandidateScope';
import type { HealthContextWindow } from './types';

export type ResolveHealthContextWindow = (
  signal?: AbortSignal,
  endAt?: string,
  timeZone?: string,
) => Promise<HealthContextWindow | null>;

/** Resolve imported, current data only. The fixed ingestion cutoff prevents later
 * arrivals from silently expanding a summary's admitted period between topics. */
export async function readAvailableHealthContextWindow(
  executor: SqlExecutor,
  signal?: AbortSignal,
  endAt = new Date().toISOString(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): Promise<HealthContextWindow | null> {
  if (signal?.aborted) throw new Error('Health context was cancelled.');
  TimestampSchema.parse(endAt);
  new Intl.DateTimeFormat('en', { timeZone }).format(new Date(endAt));
  const sources: readonly [string, RecordKind, string][] = [
    ['health_observations', 'health_observation', 'r.effective_at'],
    [
      'symptom_entries',
      'symptom_entry',
      "coalesce(json_extract(r.payload_json, '$.startedAt'), r.effective_at)",
    ],
    ['dose_events', 'dose_event', 'r.effective_at'],
    ['medication_assertions', 'medication_assertion', 'r.effective_at'],
    // A registration has no occurrence timestamp; ingestion establishes when it became available.
    [
      'medication_definitions',
      'medication_definition',
      'coalesce(r.effective_at, r.ingested_at)',
    ],
  ];
  const cutoff = localQueryTimestampKey(endAt);
  const queries = sources.map(([table, kind, occurrence]) => {
    const key = localQueryTimestampKeyExpression(occurrence);
    return `SELECT ${occurrence} AS occurred, ${key} AS time_key FROM ${table} r
      WHERE ${occurrence} IS NOT NULL AND ${key} ${kind === 'medication_definition' ? '<=' : '<'} ?
      AND ${localQueryTimestampKeyExpression('r.ingested_at')} <= ?
      AND ${currentEvidenceCondition(kind)}`;
  });
  const result = await executor.execute(
    // Each branch keeps every eligibility filter before its local minimum. The
    // global minimum is then among at most five rows, not all imported samples.
    // This is an exact minimum reduction, never a record/history result cap.
    `SELECT occurred FROM (${queries.map(query => `SELECT * FROM (${query} ORDER BY time_key LIMIT 1)`).join(' UNION ALL ')}) ORDER BY time_key LIMIT 1`,
    sources.flatMap(() => [cutoff, cutoff]),
  );
  if (signal?.aborted) throw new Error('Health context was cancelled.');
  if (!result.rows.length) return null;
  const first = result.rows[0]!.occurred;
  if (typeof first !== 'string')
    throw new Error('Invalid health context availability.');
  return {
    // A registration at the cutoff is available but is not an occurrence. Use the
    // completed reporting calendar day only to host that catalog, never invent a dose.
    fromInclusive:
      compareTimestamps(first, endAt) === 0
        ? recentHealthContextWindow(1, endAt, timeZone).fromInclusive
        : TimestampSchema.parse(first),
    toExclusive: endAt,
    timeZone,
    dataAvailableThrough: endAt,
  };
}
