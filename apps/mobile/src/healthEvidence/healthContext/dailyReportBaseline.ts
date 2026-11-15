import { dailyReportBaselineInterval, compareTimestamps } from '@orot/domain';
import type { DailyReportSourceRecord } from '@orot/domain';
import {
  localQueryTimestampKey,
  localQueryTimestampKeyExpression,
  parseRecord,
  STORAGE_TABLES,
} from '@orot/storage';
import type { SqlExecutor } from '@orot/storage';
import {
  fingerprint,
  stableJson,
} from '../../aiFeatures/integration/evidenceUtils';
import { candidateScopeCondition } from '../evidenceCandidateScope';
import type { EvidenceCandidateScope } from '../evidenceCandidateScope';
import type { LocalHealthEvidenceRecord } from '../localEvidenceQueries';
import { MAX_HEALTH_EVIDENCE_RECORD_BYTES } from '../localEvidenceQueries';
import type { DailyReportCalendarWindow } from './dailyReportWindow';
import type { DailyReportLineage } from '../../storage/dailyReportStorageTypes';

/** Only compatible point measurements. Totals, workouts and unknown imported devices
 * cannot establish a personal comparison from their display name alone. */
export function baselineMeasurement(item: LocalHealthEvidenceRecord) {
  if (
    item.kind !== 'health_observation' ||
    item.record.observationKind !== 'measurement' ||
    item.record.value.kind !== 'quantity'
  )
    return null;
  const r = item.record;
  if (
    r.value.kind !== 'quantity' ||
    !Number.isFinite(r.value.amount) ||
    r.value.amount <= 0
  )
    return null;
  if (
    ![
      'resting_heart_rate',
      'body_mass',
      'weight',
      'blood_pressure_systolic',
      'blood_pressure_diastolic',
      'blood pressure systolic',
      'blood pressure diastolic',
    ].includes(r.concept)
  )
    return null;
  if (
    r.endedAt &&
    compareTimestamps(r.endedAt, r.effectiveAt) !== 0 &&
    !r.concept.startsWith('blood')
  )
    return null;
  if (
    r.provenance.origin === 'imported' &&
    !r.provenance.source?.sourceIdentifier
  )
    return null;
  return {
    key: stableJson([
      r.concept,
      r.value.unit,
      r.provenance.origin,
      r.provenance.source,
    ]),
    amount: r.value.amount,
    concept: r.concept,
    unit: r.value.unit,
    at: r.effectiveAt,
  };
}

/** Read bounded historical context in the same transaction as today's values.
 * Exact scope, ingestion cutoff, revisions and original occurrence times are retained. */
export async function readDailyReportBaseline(
  tx: SqlExecutor,
  calendar: DailyReportCalendarWindow,
  scope: EvidenceCandidateScope,
  today: readonly LocalHealthEvidenceRecord[],
  byteBudget: number,
  signal?: AbortSignal,
) {
  const values: LocalHealthEvidenceRecord[] = [];
  const records: DailyReportSourceRecord[] = [];
  const lineage: DailyReportLineage[] = [];
  const keys = new Set(
    today.flatMap(item => {
      const point = baselineMeasurement(item);
      return point ? [point.key] : [];
    }),
  );
  const range = dailyReportBaselineInterval(
    calendar.identity.localDate,
    calendar.identity.timeZone,
  );
  if (!range || !keys.size)
    return { values, records, lineage, partial: false, bytes: 0 };
  const selected = candidateScopeCondition('health_observation', scope);
  const at = localQueryTimestampKeyExpression('r.effective_at');
  const ingestion = localQueryTimestampKeyExpression('r.ingested_at');
  const rows = (
    await tx.execute(
      `SELECT r.id, CASE WHEN length(CAST(r.payload_json AS BLOB)) <= ? THEN r.payload_json ELSE NULL END AS payload_json, length(CAST(r.payload_json AS BLOB)) AS payload_bytes FROM ${STORAGE_TABLES.health_observation.table} r WHERE ${selected.sql} AND ${at} >= ? AND ${at} < ? AND ${ingestion} <= ? AND json_extract(r.payload_json, '$.observationKind') = 'measurement' ORDER BY ${at} DESC, r.id LIMIT 101`,
      [
        MAX_HEALTH_EVIDENCE_RECORD_BYTES,
        ...selected.parameters,
        localQueryTimestampKey(range.fromInclusive),
        localQueryTimestampKey(range.toExclusive),
        localQueryTimestampKey(calendar.generationCutoff),
      ],
    )
  ).rows;
  let partial = rows.length > 100;
  let bytes = 0;
  for (const row of rows.slice(0, 100)) {
    if (signal?.aborted) throw new Error('Baseline read cancelled.');
    if (
      typeof row.payload_json !== 'string' ||
      typeof row.payload_bytes !== 'number' ||
      bytes + row.payload_bytes > byteBudget
    ) {
      partial = true;
      continue;
    }
    const payload = JSON.parse(row.payload_json);
    const record = parseRecord('health_observation', payload);
    if (record.id !== row.id) throw new Error('Baseline identity mismatch.');
    const value = { kind: 'health_observation' as const, record };
    const point = baselineMeasurement(value);
    if (
      !point ||
      !keys.has(point.key) ||
      (record.endedAt &&
        compareTimestamps(record.endedAt, range.toExclusive) > 0)
    )
      continue;
    const revision = fingerprint(payload);
    values.push(value);
    records.push({
      source: 'health_observation',
      recordId: record.id,
      revision,
      contextRole: 'personal_baseline',
      occurrence: {
        startInclusive: record.effectiveAt,
        ...(record.endedAt &&
        compareTimestamps(record.endedAt, record.effectiveAt) !== 0
          ? { endExclusive: record.endedAt }
          : {}),
      },
      ingestedAt: record.ingestedAt,
    });
    lineage.push({
      source: 'health_observation',
      recordId: record.id,
      kind: 'health_observation',
      localId: record.id,
      revision,
    });
    bytes += row.payload_bytes;
  }
  return { values, records, lineage, partial, bytes };
}
