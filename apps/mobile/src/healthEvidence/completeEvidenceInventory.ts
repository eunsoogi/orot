import type { RecordKind, SqlDatabase } from '@orot/storage';
import type { LocalHealthEvidenceInventory } from './localEvidenceRepository';
import {
  appendHealthEvidenceRows,
  checkHealthEvidenceAbort,
  DEFAULT_HEALTH_EVIDENCE_ROWS_PER_KIND,
  HEALTH_EVIDENCE_RECORD_KINDS,
  queryHealthEvidenceRows,
} from './localEvidenceQueries';
import type { LocalHealthEvidenceRecord } from './localEvidenceQueries';

/**
 * Reads the complete inventory in bounded SQL pages on one snapshot. A page
 * limit is not missing evidence; oversized rows still make coverage incomplete.
 * Yielding between pages lets navigation and cancellation events reach JS.
 */
export async function readCompleteEvidenceInventory(
  database: SqlDatabase,
  signal?: AbortSignal,
): Promise<LocalHealthEvidenceInventory> {
  const records: LocalHealthEvidenceRecord[] = [];
  const availableKinds: RecordKind[] = [];
  const truncatedKinds = new Set<RecordKind>();
  const pageSize = DEFAULT_HEALTH_EVIDENCE_ROWS_PER_KIND;
  checkHealthEvidenceAbort(signal);
  await database.transaction(async transaction => {
    for (const kind of HEALTH_EVIDENCE_RECORD_KINDS) {
      let after: string | undefined;
      while (true) {
        const rows = await queryHealthEvidenceRows(
          transaction,
          kind,
          after === undefined
            ? { kind: 'all' }
            : { kind: 'after', value: after },
          pageSize,
          signal,
        );
        if (rows.length && !availableKinds.includes(kind))
          availableKinds.push(kind);
        appendHealthEvidenceRows(kind, rows, pageSize, records, truncatedKinds);
        if (rows.length < pageSize) break;
        const next = rows[rows.length - 1]?.id;
        if (typeof next !== 'string' || next === after)
          throw new Error('Invalid evidence cursor.');
        after = next;
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        checkHealthEvidenceAbort(signal);
      }
    }
  });
  checkHealthEvidenceAbort(signal);
  return {
    inventoryComplete: truncatedKinds.size === 0,
    availableKinds,
    queriedKinds: [...HEALTH_EVIDENCE_RECORD_KINDS],
    unsupportedKinds: [],
    truncatedKinds: [...truncatedKinds],
    records,
    recordCount: records.length,
  };
}
