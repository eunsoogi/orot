import {
  localQueryTimestampKey,
  localQueryTimestampKeyExpression,
  parseRecord,
  STORAGE_TABLES,
} from '@orot/storage';
import type { RecordKind, SqlDatabase } from '@orot/storage';
import type {
  DailyReportSourceCoverage,
  DailyReportSourceRecord,
} from '@orot/domain';
import { compareTimestamps } from '@orot/domain';
import {
  fingerprint,
  stableJson,
} from '../../aiFeatures/integration/evidenceUtils';
import { candidateScopeCondition } from '../evidenceCandidateScope';
import type { EvidenceCandidateScope } from '../evidenceCandidateScope';
import { MAX_HEALTH_EVIDENCE_RECORD_BYTES } from '../localEvidenceQueries';
import type { LocalHealthEvidenceRecord } from '../localEvidenceQueries';
import type { DailyReportLineage } from '../../storage/dailyReportStorageTypes';
import type { DailyReportCalendarWindow } from './dailyReportWindow';
import {
  createDailyReportCalendarWindow,
  dailyReportSourceRecordIsAvailable,
} from './dailyReportWindow';
import {
  ensureHealthContextGeneration,
  readHealthContextGeneration,
} from './generation';

const kinds = ['health_observation', 'symptom_entry', 'dose_event'] as const;
const rowLimit = 100;
const snapshotByteLimit = 64 * 1024;

/** Reads values, source revisions and generation fences before releasing the SQLite snapshot. */
export async function readDailyReportSnapshot(
  database: SqlDatabase,
  calendar: DailyReportCalendarWindow,
  scope: EvidenceCandidateScope,
  signal?: AbortSignal,
) {
  const validated = createDailyReportCalendarWindow({
    localDate: calendar.identity.localDate,
    timeZone: calendar.identity.timeZone,
    requestedAt: calendar.generationCutoff,
  });
  if (
    validated.status !== 'ready' ||
    stableJson(validated.context) !== stableJson(calendar)
  )
    throw new Error('Invalid daily report calendar window.');
  if (scope.timeRange)
    throw new Error('Daily report scope cannot replace its calendar window.');
  // Sorting selected health records must not create plaintext temporary files.
  await database.execute('PRAGMA temp_store = MEMORY');
  let output:
    | {
        values: LocalHealthEvidenceRecord[];
        lineage: DailyReportLineage[];
        sourceSnapshot: {
          revision: string;
          mutationGeneration: number;
          deletionGeneration: number;
          records: DailyReportSourceRecord[];
          coverage: DailyReportSourceCoverage[];
        };
      }
    | undefined;
  await database.transaction(async tx => {
    await ensureHealthContextGeneration(tx);
    const generation = await readHealthContextGeneration(tx);
    const values: LocalHealthEvidenceRecord[] = [];
    const records: DailyReportSourceRecord[] = [];
    const lineage: DailyReportLineage[] = [];
    const coverage: DailyReportSourceCoverage[] = [];
    let bytes = 0;
    for (const kind of kinds) {
      if (signal?.aborted) throw new Error('Daily report snapshot cancelled.');
      const selected = candidateScopeCondition(kind, scope);
      const start = localQueryTimestampKeyExpression(
        kind === 'symptom_entry'
          ? "coalesce(json_extract(r.payload_json, '$.startedAt'), r.effective_at)"
          : 'r.effective_at',
      );
      const end = localQueryTimestampKeyExpression(
        "json_extract(r.payload_json, '$.endedAt')",
      );
      const ingestion = localQueryTimestampKeyExpression('r.ingested_at');
      const family =
        kind === 'health_observation'
          ? "AND (json_extract(r.payload_json, '$.observationKind') = 'measurement' OR json_extract(r.payload_json, '$.concept') IN ('sleep', 'HKCategoryTypeIdentifierSleepAnalysis'))"
          : '';
      const rows = calendar.dataWindow
        ? (
            await tx.execute(
              `SELECT r.id, CASE WHEN length(CAST(r.payload_json AS BLOB)) <= ? THEN r.payload_json ELSE NULL END AS payload_json, length(CAST(r.payload_json AS BLOB)) AS payload_bytes FROM ${STORAGE_TABLES[kind].table} r WHERE ${selected.sql} ${family} AND ${ingestion} <= ? AND ${start} < ? AND (${start} >= ? OR (${end} > ?)) ORDER BY ${start}, r.id LIMIT ?`,
              [
                MAX_HEALTH_EVIDENCE_RECORD_BYTES,
                ...selected.parameters,
                localQueryTimestampKey(calendar.generationCutoff),
                localQueryTimestampKey(calendar.effectiveCutoff),
                localQueryTimestampKey(calendar.interval.fromInclusive),
                localQueryTimestampKey(calendar.interval.fromInclusive),
                rowLimit + 1,
              ],
            )
          ).rows
        : [];
      let partial = rows.length > rowLimit;
      for (const row of rows.slice(0, rowLimit)) {
        if (
          typeof row.payload_json !== 'string' ||
          typeof row.payload_bytes !== 'number' ||
          bytes + row.payload_bytes > snapshotByteLimit
        ) {
          partial = true;
          continue;
        }
        const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
        const parsed = parseRecord(kind, payload);
        if (parsed.id !== row.id)
          throw new Error('Daily report record identity mismatch.');
        const decoded = { kind, record: parsed } as LocalHealthEvidenceRecord;
        const startAt =
          kind === 'symptom_entry' && typeof payload.startedAt === 'string'
            ? payload.startedAt
            : payload.effectiveAt;
        if (
          typeof startAt !== 'string' ||
          typeof payload.ingestedAt !== 'string'
        )
          throw new Error('Daily report record lacks timestamps.');
        const revision = fingerprint(payload);
        // A future interval endpoint is not evidence available by the cutoff.
        if (
          typeof payload.endedAt === 'string' &&
          compareTimestamps(payload.endedAt, calendar.effectiveCutoff) > 0
        ) {
          partial = true;
          continue;
        }
        const record: DailyReportSourceRecord = {
          source: kind,
          recordId: String(payload.id),
          revision,
          occurrence: {
            startInclusive: startAt,
            ...(typeof payload.endedAt === 'string' &&
            payload.endedAt !== startAt
              ? { endExclusive: payload.endedAt }
              : {}),
          },
          ingestedAt: payload.ingestedAt,
        };
        if (!dailyReportSourceRecordIsAvailable(record, calendar)) continue;
        bytes += row.payload_bytes;
        records.push(record);
        lineage.push({
          source: kind,
          recordId: record.recordId,
          kind: kind as RecordKind,
          localId: record.recordId,
          revision,
        });
        values.push(decoded);
      }
      coverage.push({
        source: kind,
        status: partial ? 'partial' : 'unknown',
        limitationCodes: [
          'source_sync_unknown',
          ...(partial ? ['snapshot_incomplete'] : []),
          ...(kind === 'dose_event' ? ['medication_names_not_resolved'] : []),
        ],
      });
    }
    output = {
      values,
      lineage,
      sourceSnapshot: {
        ...generation,
        revision: fingerprint([generation, records]),
        records,
        coverage,
      },
    };
  });
  if (!output || signal?.aborted)
    throw new Error('Daily report snapshot cancelled.');
  return output;
}
