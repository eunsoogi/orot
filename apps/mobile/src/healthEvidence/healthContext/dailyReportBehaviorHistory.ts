import { readSelectedEvidenceRows } from '../readSelectedEvidenceRows';
import { doseHistorySqlKey } from './dailyReportHistorySelection';
import { dailyReportBaselineInterval, compareTimestamps } from '@orot/domain';
import type { DailyReportSourceRecord } from '@orot/domain';
import {
  localQueryTimestampKey,
  localQueryTimestampKeyExpression,
  parseRecord,
  STORAGE_TABLES,
} from '@orot/storage';
import type { SqlExecutor } from '@orot/storage';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { candidateScopeCondition } from '../evidenceCandidateScope';
import type { EvidenceCandidateScope } from '../evidenceCandidateScope';
import type { LocalHealthEvidenceRecord } from '../localEvidenceQueries';
import type { DailyReportCalendarWindow } from './dailyReportWindow';
import type { DailyReportLineage } from '../../storage/dailyReportStorageTypes';

/** Medication identity comes from explicit links, never matching display names. */
export function doseHistoryKey(item: LocalHealthEvidenceRecord) {
  if (item.kind !== 'dose_event') return null;
  return item.record.eventKind === 'observed'
    ? `definition:${item.record.medicationDefinitionId}`
    : `assertion:${item.record.medicationAssertionId}`;
}

export function isRecordedWorkout(item: LocalHealthEvidenceRecord) {
  return (
    item.kind === 'health_observation' &&
    item.record.observationKind === 'measurement' &&
    Boolean(item.record.workout) &&
    item.record.concept === 'workout_duration' &&
    item.record.value.kind === 'quantity' &&
    item.record.value.unit === 'min' &&
    item.record.value.amount > 0 &&
    Boolean(item.record.endedAt) &&
    compareTimestamps(item.record.endedAt!, item.record.effectiveAt) > 0
  );
}

/** Historical behavior is a set of recorded events, not a schedule/adherence denominator.
 * Read in the same snapshot and preserve original times plus every retained row's lineage. */
export async function readDailyReportBehaviorHistory(
  tx: SqlExecutor,
  calendar: DailyReportCalendarWindow,
  scope: EvidenceCandidateScope,
  today: readonly LocalHealthEvidenceRecord[],
  byteBudget: number | null,
  signal?: AbortSignal,
) {
  const values: LocalHealthEvidenceRecord[] = [];
  const records: DailyReportSourceRecord[] = [];
  const lineage: DailyReportLineage[] = [];
  const range = dailyReportBaselineInterval(
    calendar.identity.localDate,
    calendar.identity.timeZone,
  );
  const medicationKeys = new Set(today.map(doseHistoryKey).filter(Boolean));
  let bytes = 0;
  let partial = false;
  if (!range) return { values, records, lineage, partial };
  for (const kind of ['dose_event', 'health_observation'] as const) {
    if (kind === 'dose_event' && !medicationKeys.size) continue;
    const selected = candidateScopeCondition(kind, scope);
    const sourceBudget =
      byteBudget === null
        ? null
        : kind === 'dose_event' && medicationKeys.size
          ? Math.floor(byteBudget / 2)
          : byteBudget - bytes;
    let sourceBytes = 0;
    const at = localQueryTimestampKeyExpression('r.effective_at');
    const ingestion = localQueryTimestampKeyExpression('r.ingested_at');
    const filter =
      kind === 'health_observation'
        ? "AND json_extract(r.payload_json, '$.concept') = 'workout_duration'"
        : `AND ${doseHistorySqlKey} IN (SELECT value FROM json_each(?))`;
    const rows = (
      await readSelectedEvidenceRows(
        tx,
        `SELECT r.id, r.payload_json, length(CAST(r.payload_json AS BLOB)) AS payload_bytes FROM ${STORAGE_TABLES[kind].table} r WHERE ${selected.sql} ${filter} AND ${at} >= ? AND ${at} < ? AND ${ingestion} <= ? ORDER BY ${kind === 'dose_event' ? `row_number() OVER (PARTITION BY ${doseHistorySqlKey} ORDER BY ${at} DESC, r.id),` : ''} ${at} DESC, r.id`,
        [
          ...selected.parameters,
          ...(kind === 'dose_event'
            ? [JSON.stringify([...medicationKeys])]
            : []),
          localQueryTimestampKey(range.fromInclusive),
          localQueryTimestampKey(range.toExclusive),
          localQueryTimestampKey(calendar.generationCutoff),
        ],
        signal,
      )
    ).rows;
    for (const row of rows) {
      if (signal?.aborted) throw new Error('History read cancelled.');
      if (
        typeof row.payload_json !== 'string' ||
        typeof row.payload_bytes !== 'number' ||
        (byteBudget !== null && bytes + row.payload_bytes > byteBudget) ||
        (sourceBudget !== null &&
          sourceBytes + row.payload_bytes > sourceBudget)
      ) {
        partial = true;
        continue;
      }
      const payload = JSON.parse(row.payload_json);
      const parsed = parseRecord(kind, payload);
      if (parsed.id !== row.id) throw new Error('Historical source mismatch.');
      const value = { kind, record: parsed } as LocalHealthEvidenceRecord;
      if (
        kind === 'dose_event'
          ? !medicationKeys.has(doseHistoryKey(value))
          : !isRecordedWorkout(value)
      )
        continue;
      if (
        typeof payload.endedAt === 'string' &&
        compareTimestamps(payload.endedAt, range.toExclusive) > 0
      )
        continue;
      const revision = fingerprint(payload);
      records.push({
        source: kind,
        recordId: parsed.id,
        revision,
        contextRole:
          kind === 'dose_event' ? 'medication_history' : 'activity_history',
        occurrence: {
          startInclusive: payload.effectiveAt,
          ...(typeof payload.endedAt === 'string' &&
          compareTimestamps(payload.endedAt, payload.effectiveAt) > 0
            ? { endExclusive: payload.endedAt }
            : {}),
        },
        ingestedAt: parsed.ingestedAt,
      });
      lineage.push({
        source: kind,
        recordId: parsed.id,
        kind,
        localId: parsed.id,
        revision,
      });
      values.push(value);
      bytes += row.payload_bytes;
      sourceBytes += row.payload_bytes;
    }
  }
  return { values, records, lineage, partial };
}
