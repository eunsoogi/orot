import { RecordIdSchema, TimestampSchema } from '@orot/domain';
import type { DoseEvent, MedicationDefinition } from '@orot/domain';
import type { HealthObservationCursor } from './healthObservationPages';
import { localQueryTimestampKey, localQueryTimestampKeyExpression } from './localQueryTimestamp';
import { decodeStoredRecord } from './recordPersistence';
import type { SqlExecutor, SqlValue } from './sql';

export interface HealthMedicationPageRequest {
  readonly cursor?: HealthObservationCursor | null;
  readonly fromInclusive?: string;
  readonly toInclusive: string;
  readonly includeTotals?: boolean;
}
export interface HealthMedicationPage {
  readonly definitions: readonly MedicationDefinition[];
  readonly doseEvents: readonly Extract<DoseEvent, { eventKind: 'observed' }>[];
  readonly nextCursor?: HealthObservationCursor | null;
  readonly totalDefinitions?: number;
  readonly totalDoseEvents?: number;
}

const imported =
  "json_extract(payload_json, '$.provenance.origin') = 'imported' AND " +
  "json_extract(payload_json, '$.provenance.source.system') = 'healthkit'";
const observed = "json_extract(payload_json, '$.eventKind') = 'observed' AND " + imported;
const time = localQueryTimestampKeyExpression('effective_at');

/** The partial index supports latest-first dose paging without sorting the full history. */
export async function createHealthMedicationLibraryIndex(executor: SqlExecutor): Promise<void> {
  await executor.execute(`CREATE INDEX IF NOT EXISTS dose_events_library_idx
    ON dose_events ((${time}) DESC, id ASC) WHERE ${observed}`);
}

/** Decodes at most 100 doses and their names; optional totals stay scalar SQL counts. */
export async function readHealthMedicationPage(
  executor: SqlExecutor,
  request: HealthMedicationPageRequest,
): Promise<HealthMedicationPage> {
  const to = localQueryTimestampKey(TimestampSchema.parse(request.toInclusive));
  const from =
    request.fromInclusive === undefined
      ? null
      : localQueryTimestampKey(TimestampSchema.parse(request.fromInclusive));
  if (from !== null && from > to) throw new Error('Medication period is invalid.');
  const clauses = [observed, `(${time}) <= ?`];
  const parameters: SqlValue[] = [to];
  if (from !== null) {
    clauses.push(`(${time}) >= ?`);
    parameters.push(from);
  }
  const totals = request.includeTotals
    ? await readTotals(executor, clauses.join(' AND '), parameters)
    : {};
  if (request.cursor) {
    const key = localQueryTimestampKey(TimestampSchema.parse(request.cursor.effectiveAt));
    RecordIdSchema.parse(request.cursor.id);
    clauses.push(`(${time}) <= ? AND ((${time}) < ? OR id > ?)`);
    parameters.push(key, key, request.cursor.id);
  }
  // The older ascending query index otherwise wins on some SQLite versions,
  // forcing a large equal-time group to be sorted before returning a page.
  const result = await executor.execute(
    'SELECT payload_json FROM dose_events INDEXED BY dose_events_library_idx WHERE ' +
      clauses.join(' AND ') +
      ` ORDER BY (${time}) DESC, id ASC LIMIT 101`,
    parameters,
  );
  const doseEvents = result.rows.slice(0, 100).map((row) => {
    const event = decodeStoredRecord('dose_event', row.payload_json);
    if (event.eventKind !== 'observed') throw new Error('A stored medication dose is invalid.');
    return event;
  });
  const ids = [...new Set(doseEvents.map((event) => event.medicationDefinitionId))];
  const names =
    ids.length === 0
      ? { rows: [] }
      : await executor.execute(
          'SELECT payload_json FROM medication_definitions WHERE id IN (SELECT value FROM json_each(?)) AND ' +
            imported,
          [JSON.stringify(ids)],
        );
  const last = doseEvents[doseEvents.length - 1];
  return {
    definitions: names.rows.map((row) =>
      decodeStoredRecord('medication_definition', row.payload_json),
    ),
    doseEvents,
    nextCursor:
      result.rows.length > 100 && last ? { effectiveAt: last.effectiveAt, id: last.id } : null,
    ...totals,
  };
}

async function readTotals(executor: SqlExecutor, where: string, parameters: SqlValue[]) {
  const definitions = await executor.execute(
    'SELECT COUNT(*) AS count FROM medication_definitions WHERE ' + imported,
  );
  const doses = await executor.execute(
    'SELECT COUNT(*) AS count FROM dose_events WHERE ' + where,
    parameters,
  );
  const count = (value: unknown) => {
    const result = Number(value);
    if (!Number.isSafeInteger(result) || result < 0)
      throw new Error('Medication count is invalid.');
    return result;
  };
  return {
    totalDefinitions: count(definitions.rows[0]?.count),
    totalDoseEvents: count(doses.rows[0]?.count),
  };
}
