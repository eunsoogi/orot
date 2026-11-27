import { emptyDailyActivityCoverage } from './dailyReportActivityCoverage';
import { readSelectedEvidenceRows } from '../readSelectedEvidenceRows';
import { dailyReportOccurrence } from './dailyReportOccurrence';
import { dailyReportCandidateOrder } from './dailyReportCandidateOrder';
import { readDailyReportHistory } from './dailyReportHistory';
import { readDailyReportMedicationContext } from './dailyReportMedicationContext';
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
import {
  finishDailyReportSnapshot,
  type SnapshotRevisionInput,
} from './finishDailyReportSnapshot';
import { candidateScopeCondition } from '../evidenceCandidateScope';
import type { EvidenceCandidateScope } from '../evidenceCandidateScope';
import type { LocalHealthEvidenceRecord } from '../localEvidenceQueries';
import type { DailyReportCalendarWindow } from './dailyReportWindow';
import {
  validateDailyReportCalendarWindow,
  dailyReportSourceRecordIsAvailable,
} from './dailyReportWindow';
import { readHealthContextGeneration } from './generation';
import { dailyReportGenerationPreparation } from './dailyReportGenerationPreparation';

const kinds = [
  'health_observation',
  'symptom_entry',
  'dose_event',
  'appointment',
] as const;

/** Read all source values and generation fences on one SQLite snapshot. */
export async function readDailyReportSnapshot(
  database: SqlDatabase,
  calendar: DailyReportCalendarWindow,
  scope: EvidenceCandidateScope,
  signal?: AbortSignal,
) {
  validateDailyReportCalendarWindow(calendar);
  if (scope.timeRange)
    throw new Error('Daily report scope cannot replace its calendar window.');
  // Sorting selected health records must not create plaintext temporary files.
  await database.execute('PRAGMA temp_store = MEMORY');
  let output: Parameters<typeof finishDailyReportSnapshot>[0] | undefined;
  const revisions: SnapshotRevisionInput[] = [];
  const preparation = dailyReportGenerationPreparation(database);
  await preparation.transaction(
    async tx => {
      if (!(await preparation.reuse(tx))) await preparation.prepare(tx);
      const generation = await readHealthContextGeneration(tx);
      const values: LocalHealthEvidenceRecord[] = [];
      const coverage: DailyReportSourceCoverage[] = [];
      for (const kind of kinds) {
        if (signal?.aborted)
          throw new Error('Daily report snapshot cancelled.');
        const selected = candidateScopeCondition(kind, scope);
        const start = localQueryTimestampKeyExpression(
          kind === 'symptom_entry'
            ? "coalesce(json_extract(r.payload_json, '$.startedAt'), r.effective_at)"
            : 'r.effective_at',
        );
        const end = localQueryTimestampKeyExpression(
          kind === 'symptom_entry'
            ? "json_extract(r.payload_json, '$.resolvedAt')"
            : "json_extract(r.payload_json, '$.endedAt')",
        );
        const ingestion = localQueryTimestampKeyExpression('r.ingested_at');
        const family =
          kind === 'health_observation'
            ? "AND (json_extract(r.payload_json, '$.observationKind') = 'measurement' OR json_extract(r.payload_json, '$.concept') IN ('sleep', 'HKCategoryTypeIdentifierSleepAnalysis'))"
            : '';
        const rows = calendar.dataWindow
          ? (
              await readSelectedEvidenceRows(
                tx,
                `SELECT r.id, r.payload_json, length(CAST(r.payload_json AS BLOB)) AS payload_bytes FROM ${STORAGE_TABLES[kind].table} r WHERE ${selected.sql} ${family} AND ${ingestion} <= ? AND ${start} < ? AND (${start} >= ? OR (${end} > ?) ${kind === 'symptom_entry' ? "OR (json_extract(r.payload_json, '$.status') = 'active' AND json_extract(r.payload_json, '$.resolvedAt') IS NULL)" : ''}) ORDER BY ${dailyReportCandidateOrder(kind, start)}`,
                [
                  ...selected.parameters,
                  localQueryTimestampKey(calendar.generationCutoff),
                  localQueryTimestampKey(
                    kind === 'appointment'
                      ? calendar.interval.toExclusive
                      : calendar.effectiveCutoff,
                  ),
                  localQueryTimestampKey(calendar.interval.fromInclusive),
                  localQueryTimestampKey(calendar.interval.fromInclusive),
                ],
                signal,
              )
            ).rows
          : [];
        let partial = false;
        for (const row of rows) {
          if (
            typeof row.payload_json !== 'string' ||
            typeof row.payload_bytes !== 'number'
          ) {
            partial = true;
            continue;
          }
          const payload = JSON.parse(row.payload_json) as Record<
            string,
            unknown
          >;
          const parsed = parseRecord(kind, payload);
          if (parsed.id !== row.id)
            throw new Error('Daily report record identity mismatch.');
          const decoded = { kind, record: parsed } as LocalHealthEvidenceRecord;
          const temporal = dailyReportOccurrence(decoded, payload, calendar);
          if (!temporal) {
            partial = true;
            continue;
          }
          const record: Omit<DailyReportSourceRecord, 'revision'> = {
            source: kind,
            recordId: String(payload.id),
            ...temporal,
            ingestedAt: parsed.ingestedAt,
          };
          if (!dailyReportSourceRecordIsAvailable(record, calendar)) continue;
          revisions.push({
            record,
            payload,
            lineage: {
              source: kind,
              recordId: record.recordId,
              kind: kind as RecordKind,
              localId: record.recordId,
            },
          });
          values.push(decoded);
        }
        coverage.push({
          source: kind,
          status: partial ? 'partial' : 'unknown',
          limitationCodes: [
            'source_sync_unknown',
            ...(kind === 'symptom_entry' &&
            revisions.some(
              ({ record }) => record.contextRole === 'ongoing_symptom',
            )
              ? ['ongoing_symptom_context']
              : []),
            ...(partial
              ? ['snapshot_incomplete', 'bounded_source_sampling']
              : []),
            ...(kind === 'dose_event' ? ['medication_names_not_resolved'] : []),
            ...(kind === 'appointment' ? ['confirmed_appointments_only'] : []),
          ],
        });
      }
      // Supporting identity records retain their original times and own deletion lineage.
      const medications = await readDailyReportMedicationContext(
        tx,
        values,
        scope,
        calendar.generationCutoff,
      );
      const linkedDoses = new Set<string>();
      for (const item of medications) {
        const recordId = item.value.record.id;
        revisions.push({
          payload: item.payload,
          record: {
            source: item.value.kind,
            recordId,
            occurrence: { startInclusive: item.at },
            ingestedAt: item.value.record.ingestedAt,
            supportingRecordFor: item.doses,
          },
          lineage: {
            source: item.value.kind,
            recordId,
            kind: item.value.kind,
            localId: recordId,
          },
        });
        values.push(item.value);
        item.doses.forEach(id => linkedDoses.add(id));
      }
      const unresolved = values.some(
        item => item.kind === 'dose_event' && !linkedDoses.has(item.record.id),
      );
      if (!unresolved) {
        const doseCoverage = coverage.find(
          item => item.source === 'dose_event',
        );
        if (doseCoverage)
          doseCoverage.limitationCodes = doseCoverage.limitationCodes.filter(
            code => code !== 'medication_names_not_resolved',
          );
      }
      const observationCoverage = coverage.find(
        item => item.source === 'health_observation',
      );
      // This is a result of the same protected query, never a second sync probe.
      if (
        calendar.dataWindow &&
        !scope.sourceIds &&
        observationCoverage?.status === 'unknown' &&
        observationCoverage.limitationCodes.every(
          code => code === 'source_sync_unknown',
        )
      ) {
        coverage.push(
          ...emptyDailyActivityCoverage(values, calendar.generationCutoff),
        );
      }
      const history = await readDailyReportHistory(
        tx,
        calendar,
        scope,
        values,
        null,
        signal,
      );
      coverage.push(...history.coverage);
      output = {
        baselineValues: history.baselineValues,
        behaviorValues: history.behaviorValues,
        values,
        lineage: history.lineage,
        sourceSnapshot: {
          ...generation,
          records: history.records,
          coverage,
        },
      };
    },
    () => !signal?.aborted,
  );
  if (!output || signal?.aborted)
    throw new Error('Daily report snapshot cancelled.');
  return finishDailyReportSnapshot(output, revisions, signal);
}
