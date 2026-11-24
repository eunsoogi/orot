import { TimestampSchema } from '@orot/domain';
import { localQueryTimestampKey, localQueryTimestampKeyExpression } from './localQueryTimestamp';
import type { SqlExecutor } from './sql';

const maximumDoseRecords = 10_000;
const maximumNamedMedications = 128;
export type MedicationTakenPeriod = {
  readonly fromInclusive: string;
  readonly toInclusive: string;
};
type TakenMedicationCount = {
  readonly medicationId: string;
  readonly name: string;
  readonly count: number;
};
export type MedicationTakenMonth = MedicationTakenPeriod &
  (
    | { readonly status: 'unverified' }
    | {
        readonly status: 'complete';
        readonly observedCount: number;
        readonly takenCount: number;
        readonly unverifiedCount: number;
        readonly medications: readonly TakenMedicationCount[];
      }
  );
const imported = (column: string) =>
  `json_extract(${column}, '$.provenance.origin') = 'imported' AND json_extract(${column}, '$.provenance.source.system') = 'healthkit'`;

/** One bounded, protected SQL snapshot of existing imported events and exact definitions. */
export async function readMedicationTakenMonth(
  executor: SqlExecutor,
  period: MedicationTakenPeriod,
): Promise<MedicationTakenMonth> {
  const { fromInclusive, toInclusive } = period;
  const from = localQueryTimestampKey(TimestampSchema.parse(fromInclusive));
  const to = localQueryTimestampKey(TimestampSchema.parse(toInclusive));
  const start = Date.parse(fromInclusive);
  const end = Date.parse(toInclusive);
  if (from >= to || !Number.isFinite(end - start) || end - start > 31 * 86_400_000) {
    throw new Error('Medication summary period is invalid.');
  }
  const time = localQueryTimestampKeyExpression('effective_at');
  const { rows } = await executor.execute(
    `SELECT * FROM (WITH candidates AS MATERIALIZED (
      SELECT json_extract(payload_json, '$.observationStatus') AS status,
             json_extract(payload_json, '$.medicationDefinitionId') AS medication_id
      FROM dose_events INDEXED BY dose_events_library_idx
      WHERE json_extract(payload_json, '$.eventKind') = 'observed'
        AND ${imported('payload_json')} AND (${time}) >= ? AND (${time}) <= ?
      ORDER BY (${time}) DESC, id ASC LIMIT ?
    ), groups AS (
      SELECT d.id AS medication_id, json_extract(d.payload_json, '$.displayText') AS name,
             COUNT(*) AS taken
      FROM candidates c
      JOIN medication_definitions d ON d.id = c.medication_id AND ${imported('d.payload_json')}
      WHERE c.status = 'taken'
        AND length(trim(json_extract(d.payload_json, '$.displayText'))) > 0
        AND length(trim(json_extract(d.payload_json, '$.medicationConceptIdentifier'))) > 0
      GROUP BY d.id
    ), totals AS (
      SELECT COUNT(*) AS candidates,
             COALESCE(SUM(CASE WHEN status IS NULL OR status NOT IN ('skipped', 'taken') THEN 1 ELSE 0 END), 0) AS unknown,
             COALESCE(SUM(CASE WHEN status = 'taken' THEN 1 ELSE 0 END), 0) AS claimed,
             (SELECT COUNT(*) FROM groups) AS medication_count
      FROM candidates
    )
    SELECT totals.*, groups.* FROM totals LEFT JOIN groups ON 1 = 1
    ORDER BY taken DESC, name COLLATE NOCASE ASC, medication_id ASC LIMIT ?)`,
    [from, to, maximumDoseRecords + 1, maximumNamedMedications + 1],
  );
  const first = rows[0];
  if (!first) throw new Error('Medication summary unavailable.');
  const count = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new Error('Medication summary count is invalid.');
    }
    return value;
  };
  if (
    count(first.candidates) > maximumDoseRecords ||
    count(first.medication_count) > maximumNamedMedications
  )
    return { ...period, status: 'unverified' };
  const medications = rows.flatMap((row) => {
    if (row.medication_id === null) return [];
    if (typeof row.medication_id !== 'string' || typeof row.name !== 'string' || !row.name.trim())
      throw new Error('Medication summary identity is unavailable.');
    return [{ medicationId: row.medication_id, name: row.name, count: count(row.taken) }];
  });
  const takenCount = medications.reduce((sum, item) => sum + item.count, 0);
  const claimed = count(first.claimed);
  if (medications.length !== count(first.medication_count) || takenCount > claimed) {
    throw new Error('Medication summary coverage is unavailable.');
  }
  return {
    ...period,
    status: 'complete',
    observedCount: count(first.candidates),
    takenCount,
    unverifiedCount: count(first.unknown) + claimed - takenCount,
    medications,
  };
}
