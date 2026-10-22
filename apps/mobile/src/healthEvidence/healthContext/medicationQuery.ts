import {
  localQueryTimestampKey,
  localQueryTimestampKeyExpression,
} from '@orot/storage';
import type { SqlExecutor, SqlValue } from '@orot/storage';
import { currentEvidenceCondition } from '../evidenceCandidateScope';
import { healthContextDays } from './window';
import type { HealthContextWindow, HealthMedicationProfile } from './types';

/** Current registrations have no HealthKit creation time; dose history uses actual occurrence times. */
export async function readHealthMedicationContext(
  executor: SqlExecutor,
  window: HealthContextWindow,
  signal?: AbortSignal,
): Promise<{
  medications: readonly HealthMedicationProfile[];
  truncated: boolean;
}> {
  if (signal?.aborted) throw new Error('Health context was cancelled.');
  const at = localQueryTimestampKeyExpression('d.effective_at');
  const days = healthContextDays(window);
  const parameters: SqlValue[] = days.flatMap(day => [
    day.date,
    localQueryTimestampKey(day.fromInclusive),
    localQueryTimestampKey(day.toExclusive),
  ]);
  parameters.push(
    localQueryTimestampKey(window.toExclusive),
    localQueryTimestampKey(window.fromInclusive),
    localQueryTimestampKey(window.fromInclusive),
    localQueryTimestampKey(window.toExclusive),
  );
  const result = await executor.execute(
    `SELECT * FROM (
    WITH days(date, from_key, to_key) AS (VALUES ${days.map(() => '(?, ?, ?)').join(', ')}), catalog AS (
      SELECT id, json_extract(payload_json, '$.displayText') AS name,
        'healthkit_registration' AS source, json_extract(payload_json, '$.hasSchedule') AS schedule,
        json_extract(payload_json, '$.isArchived') AS archived, NULL AS instruction, NULL AS confirmed
      FROM medication_definitions r WHERE ${currentEvidenceCondition('medication_definition')}
      UNION ALL
      SELECT id, json_extract(payload_json, '$.medicationName') AS name,
        CASE json_extract(payload_json, '$.assertionKind')
          WHEN 'current_medication_confirmation' THEN 'current_user_confirmation' ELSE 'prescription_record' END,
        NULL, NULL, json_extract(payload_json, '$.dosageInstruction'), effective_at
      FROM medication_assertions r
      WHERE effective_at IS NOT NULL AND ${localQueryTimestampKeyExpression('effective_at')} < ?
        AND ${currentEvidenceCondition('medication_assertion')}
        AND (json_extract(payload_json, '$.endsAt') IS NULL
          OR ${localQueryTimestampKeyExpression("json_extract(payload_json, '$.endsAt')")} >= ?)
    ), scoped_doses AS (
      SELECT coalesce(json_extract(d.payload_json, '$.medicationDefinitionId'),
                      json_extract(d.payload_json, '$.medicationAssertionId')) AS medication,
        json_extract(d.payload_json, '$.eventKind') AS event,
        json_extract(d.payload_json, '$.observationStatus') AS status,
        d.effective_at AS occurred_at, ${at} AS time_key, day.date AS date
      FROM dose_events d JOIN days day ON ${at} >= day.from_key AND ${at} < day.to_key
      WHERE ${at} >= ? AND ${at} < ?
        AND ${currentEvidenceCondition('dose_event').replaceAll('r.id', 'd.id')}
    ), ordered_doses AS (
      SELECT *, row_number() OVER (PARTITION BY medication ORDER BY time_key, occurred_at) AS oldest,
        row_number() OVER (PARTITION BY medication ORDER BY time_key DESC, occurred_at) AS newest
      FROM scoped_doses
    ), dose_counts AS (
      SELECT medication,
        sum(CASE WHEN event IN ('taken', 'administered') OR status = 'taken' THEN 1 ELSE 0 END) AS taken,
        sum(CASE WHEN event = 'missed' OR status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
        count(*) AS events, count(DISTINCT date) AS days,
        min(CASE WHEN oldest = 1 THEN occurred_at END) AS first_at,
        min(CASE WHEN newest = 1 THEN occurred_at END) AS last_at
      FROM ordered_doses GROUP BY medication
    )
    SELECT c.*, coalesce(d.taken, 0) AS taken, coalesce(d.skipped, 0) AS skipped,
      coalesce(d.events, 0) AS events, coalesce(d.days, 0) AS days, d.first_at, d.last_at
    FROM catalog c LEFT JOIN dose_counts d ON d.medication = c.id
    WHERE c.archived IS NULL OR c.archived = 0 OR d.events > 0
    ORDER BY c.source, c.name, c.id LIMIT 33
  )`,
    parameters,
  );
  if (signal?.aborted) throw new Error('Health context was cancelled.');
  const medications = result.rows.slice(0, 32).map(row => {
    if (
      typeof row.id !== 'string' ||
      typeof row.name !== 'string' ||
      !row.name.trim() ||
      ![
        'healthkit_registration',
        'current_user_confirmation',
        'prescription_record',
      ].includes(String(row.source)) ||
      !['taken', 'skipped', 'events', 'days'].every(
        key =>
          typeof row[key] === 'number' &&
          Number.isSafeInteger(row[key]) &&
          Number(row[key]) >= 0,
      )
    )
      throw new Error('Health context returned invalid medication statistics.');
    return {
      identity: row.id,
      name: row.name,
      source: row.source as HealthMedicationProfile['source'],
      ...(typeof row.schedule === 'number'
        ? { scheduleRegistered: row.schedule === 1 }
        : {}),
      ...(typeof row.archived === 'number'
        ? { archived: row.archived === 1 }
        : {}),
      ...(typeof row.instruction === 'string'
        ? { dosageInstruction: row.instruction }
        : {}),
      ...(typeof row.confirmed === 'string'
        ? { assertedAt: row.confirmed }
        : {}),
      taken: row.taken as number,
      skipped: row.skipped as number,
      otherDoseRecords:
        Number(row.events) - Number(row.taken) - Number(row.skipped),
      // Days with recorded events are not a prescribed-dose or adherence denominator.
      daysWithDoseRecords: row.days as number,
      ...(typeof row.first_at === 'string'
        ? { firstDoseAt: row.first_at }
        : {}),
      ...(typeof row.last_at === 'string' ? { lastDoseAt: row.last_at } : {}),
    };
  });
  return { medications, truncated: result.rows.length > 32 };
}
