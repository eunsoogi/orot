import {
  localQueryTimestampKey,
  localQueryTimestampKeyExpression,
} from '@orot/storage';
import type { SqlExecutor, SqlValue } from '@orot/storage';
import { currentEvidenceCondition } from '../evidenceCandidateScope';
import type { HealthContextWindow, HealthDoseHistory } from './types';

/** Pages event instants in a half-open range; a schedule is not evidence of intake. */
export async function readDoseHistory(
  executor: SqlExecutor,
  window: HealthContextWindow,
): Promise<HealthDoseHistory> {
  const selection = window.doseHistory;
  if (
    !selection ||
    !Number.isInteger(selection.page) ||
    selection.page < 0 ||
    selection.page > 1000 ||
    !Number.isInteger(selection.pageSize) ||
    selection.pageSize < 1 ||
    selection.pageSize > 20 ||
    (selection.medicationName !== undefined &&
      (!selection.medicationName.trim() ||
        selection.medicationName.length > 200))
  )
    throw new RangeError('Invalid dose history selection.');
  const time = localQueryTimestampKeyExpression('d.effective_at');
  const name =
    "coalesce(json_extract(m.payload_json, '$.displayText'), json_extract(a.payload_json, '$.medicationName'))";
  const parameters: SqlValue[] = [
    localQueryTimestampKey(window.fromInclusive),
    localQueryTimestampKey(window.toExclusive),
  ];
  if (selection.medicationName !== undefined)
    parameters.push(selection.medicationName);
  parameters.push(selection.pageSize + 1, selection.page * selection.pageSize);
  const result = await executor.execute(
    `SELECT d.payload_json AS payload, ${name} AS name FROM dose_events d
    LEFT JOIN medication_definitions m ON m.id = json_extract(d.payload_json, '$.medicationDefinitionId') AND ${currentEvidenceCondition('medication_definition').replaceAll('r.id', 'm.id')}
    LEFT JOIN medication_assertions a ON a.id = json_extract(d.payload_json, '$.medicationAssertionId') AND ${currentEvidenceCondition('medication_assertion').replaceAll('r.id', 'a.id')}
    WHERE ${time} >= ? AND ${time} < ? AND ${currentEvidenceCondition('dose_event').replaceAll('r.id', 'd.id')}
    ${selection.medicationName === undefined ? '' : `AND ${name} = ? COLLATE NOCASE`}
    ORDER BY ${time}, d.id LIMIT ? OFFSET ?`,
    parameters,
  );
  const records = result.rows.slice(0, selection.pageSize).map(row => {
    const event = JSON.parse(String(row.payload)) as Record<string, unknown>;
    if (
      typeof event.effectiveAt !== 'string' ||
      typeof event.eventKind !== 'string'
    )
      throw new Error('Invalid dose event.');
    const dose = event.dose as { amount?: number; unit: string } | undefined;
    return {
      medicationName: typeof row.name === 'string' ? row.name : null,
      effectiveAt: event.effectiveAt,
      eventKind: event.eventKind,
      ...(typeof event.scheduledAt === 'string'
        ? { scheduledAt: event.scheduledAt }
        : {}),
      ...(typeof event.observationStatus === 'string'
        ? { observationStatus: event.observationStatus }
        : {}),
      ...(typeof event.scheduleType === 'string'
        ? { scheduleType: event.scheduleType }
        : {}),
      ...(dose ? { dose } : {}),
    };
  });
  return { records, hasMore: result.rows.length > selection.pageSize };
}
