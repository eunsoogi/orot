import { utf8ByteLength } from '../../aiFeatures/integration/evidenceUtils';
import { parseRecord, STORAGE_TABLES } from '@orot/storage';
import type { SqlExecutor } from '@orot/storage';
import { compareTimestamps } from '@orot/domain';
import { candidateScopeCondition } from '../evidenceCandidateScope';
import type { EvidenceCandidateScope } from '../evidenceCandidateScope';
import type { LocalHealthEvidenceRecord } from '../localEvidenceQueries';

const medicationKinds = [
  'medication_definition',
  'medication_assertion',
] as const;
const linkPageSize = 50;

type Link = {
  kind: (typeof medicationKinds)[number];
  id: string;
  doses: string[];
};
type MedicationContext = {
  value: LocalHealthEvidenceRecord;
  payload: Record<string, unknown>;
  bytes: number;
  doses: string[];
  at: string;
};

/** Read only explicit dose links under the same SQLite transaction and source
 * authorization. Missing, future, stale or oversized metadata stays unresolved. */
export async function readDailyReportMedicationContext(
  tx: SqlExecutor,
  values: readonly LocalHealthEvidenceRecord[],
  scope: EvidenceCandidateScope,
  cutoff: string,
) {
  const links = new Map<string, Link>();
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
  const resolved = new Map<Link, MedicationContext>();
  for (const kind of medicationKinds) {
    const selected = candidateScopeCondition(kind, scope);
    const typedLinks = [...links.values()].filter(link => link.kind === kind);
    for (let offset = 0; offset < typedLinks.length; offset += linkPageSize) {
      const page = new Map(
        typedLinks
          .slice(offset, offset + linkPageSize)
          .map(link => [link.id, link]),
      );
      // A single JSON binding preserves the original bind count for large source scopes.
      const { rows } = await tx.execute(
        `SELECT r.id, r.payload_json FROM ${STORAGE_TABLES[kind].table} r WHERE r.id IN (SELECT value FROM json_each(?)) AND ${selected.sql}`,
        [JSON.stringify([...page.keys()]), ...selected.parameters],
      );
      for (const row of rows) {
        if (typeof row.payload_json !== 'string') continue;
        const link = typeof row.id === 'string' ? page.get(row.id) : undefined;
        const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
        const record = parseRecord(kind, payload);
        if (!link || record.id !== link.id)
          throw new Error('Medication context identity mismatch.');
        const at = record.effectiveAt ?? record.ingestedAt;
        if (
          compareTimestamps(record.ingestedAt, cutoff) > 0 ||
          compareTimestamps(at, cutoff) > 0
        )
          continue;
        resolved.set(link, {
          value: { kind, record } as LocalHealthEvidenceRecord,
          payload,
          bytes: utf8ByteLength(row.payload_json),
          doses: link.doses,
          at,
        });
      }
    }
  }
  // Supporting records and their dose lists keep the original first-linked order.
  return [...links.values()].flatMap(link => {
    const item = resolved.get(link);
    return item ? [item] : [];
  });
}
