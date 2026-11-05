import {
  localQueryTimestampKey,
  localQueryTimestampKeyExpression,
  type SqlExecutor,
} from '@orot/storage';
import type { HealthContextWindow } from '../healthEvidence/healthContext/types';
import { currentEvidenceCondition } from '../healthEvidence/evidenceCandidateScope';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';

const time = localQueryTimestampKeyExpression('d.effective_at');
const name =
  "coalesce(json_extract(m.payload_json, '$.displayText'), json_extract(a.payload_json, '$.medicationName'))";
const joins = `FROM dose_events d
  LEFT JOIN medication_definitions m ON m.id = json_extract(d.payload_json, '$.medicationDefinitionId') AND ${currentEvidenceCondition('medication_definition').replaceAll('r.id', 'm.id')}
  LEFT JOIN medication_assertions a ON a.id = json_extract(d.payload_json, '$.medicationAssertionId') AND ${currentEvidenceCondition('medication_assertion').replaceAll('r.id', 'a.id')}`;

/** Resolve a filter to an existing record identity; the supplied name is never written. */
export async function findToolMedicationAnchor(
  tx: SqlExecutor,
  window: HealthContextWindow,
  filter: string,
): Promise<string | null> {
  const result = await tx.execute(
    `SELECT d.id ${joins} WHERE ${time} >= ? AND ${time} < ? AND ${currentEvidenceCondition('dose_event').replaceAll('r.id', 'd.id')} AND ${name} = ? COLLATE NOCASE ORDER BY ${time}, d.id LIMIT 1`,
    [
      localQueryTimestampKey(window.fromInclusive),
      localQueryTimestampKey(window.toExclusive),
      filter,
    ],
  );
  return typeof result.rows[0]?.id === 'string'
    ? fingerprint({ kind: 'tool-dose-anchor', id: result.rows[0].id })
    : null;
}

/** Re-read the current source name only in memory; deletion or correction makes it unavailable. */
export async function readToolMedicationAnchor(
  tx: SqlExecutor,
  window: HealthContextWindow,
  anchor: string,
): Promise<string | null> {
  let cursor = '';
  let found: string | null = null;
  for (;;) {
    const result = await tx.execute(
      `SELECT d.id, ${name} AS name ${joins} WHERE d.id > ? AND ${time} >= ? AND ${time} < ? AND ${currentEvidenceCondition('dose_event').replaceAll('r.id', 'd.id')} ORDER BY d.id LIMIT 128`,
      [
        cursor,
        localQueryTimestampKey(window.fromInclusive),
        localQueryTimestampKey(window.toExclusive),
      ],
    );
    for (const row of result.rows) {
      if (typeof row.id !== 'string' || !row.id || row.id === cursor)
        throw new Error('Invalid medication source identity.');
      cursor = row.id;
      if (fingerprint({ kind: 'tool-dose-anchor', id: row.id }) === anchor) {
        if (found !== null || typeof row.name !== 'string') return null;
        found = row.name;
      }
    }
    if (result.rows.length < 128) return found;
  }
}
