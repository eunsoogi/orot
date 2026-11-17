import { utf8ByteLength } from '../../aiFeatures/integration/evidenceUtils';
import { parseRecord, STORAGE_TABLES } from '@orot/storage';
import type { SqlExecutor } from '@orot/storage';
import { compareTimestamps } from '@orot/domain';
import { candidateScopeCondition } from '../evidenceCandidateScope';
import type { EvidenceCandidateScope } from '../evidenceCandidateScope';
import type { LocalHealthEvidenceRecord } from '../localEvidenceQueries';

/** Read only explicit dose links under the same SQLite transaction and source
 * authorization. Missing, future, stale or oversized metadata stays unresolved. */
export async function readDailyReportMedicationContext(
  tx: SqlExecutor,
  values: readonly LocalHealthEvidenceRecord[],
  scope: EvidenceCandidateScope,
  cutoff: string,
) {
  const links = new Map<
    string,
    {
      kind: 'medication_definition' | 'medication_assertion';
      id: string;
      doses: string[];
    }
  >();
  for (const item of values) {
    if (item.kind !== 'dose_event') continue;
    const imported = item.record.eventKind === 'observed';
    const kind = imported ? 'medication_definition' : 'medication_assertion';
    const id =
      item.record.eventKind === 'observed'
        ? item.record.medicationDefinitionId
        : item.record.medicationAssertionId;
    const key = `${kind}:${id}`;
    const link = links.get(key) ?? { kind, id, doses: [] };
    link.doses.push(item.record.id);
    links.set(key, link);
  }
  const result: {
    value: LocalHealthEvidenceRecord;
    payload: Record<string, unknown>;
    bytes: number;
    doses: string[];
    at: string;
  }[] = [];
  for (const link of links.values()) {
    const selected = candidateScopeCondition(link.kind, scope);
    const row = (
      await tx.execute(
        `SELECT r.payload_json FROM ${STORAGE_TABLES[link.kind].table} r WHERE r.id = ? AND ${selected.sql} `,
        [link.id, ...selected.parameters],
      )
    ).rows[0];
    if (typeof row?.payload_json !== 'string') continue;
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    const record = parseRecord(link.kind, payload);
    const at = record.effectiveAt ?? record.ingestedAt;
    if (record.id !== link.id)
      throw new Error('Medication context identity mismatch.');
    if (
      compareTimestamps(record.ingestedAt, cutoff) > 0 ||
      compareTimestamps(at, cutoff) > 0
    )
      continue;
    result.push({
      value: { kind: link.kind, record } as LocalHealthEvidenceRecord,
      payload,
      bytes: utf8ByteLength(row.payload_json),
      doses: link.doses,
      at,
    });
  }
  return result;
}
