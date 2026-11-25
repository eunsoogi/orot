import type { SqlResult } from '@orot/storage';
import {
  decodeAgentMemoryRecord,
  referencesAnySource,
} from './agentMemoryStorageRecords';

export interface ScopedMemoryCascade {
  readonly namespaceIdentity: string;
  readonly candidates: ReadonlySet<string>;
}

/** The durable transaction may expand fences only for current source-linked members of the same owner. */
export function scopedMemoryCascadeFences(
  rows: SqlResult['rows'],
  scope: ScopedMemoryCascade,
  sources: Set<string>,
): Set<string> {
  const result = new Set<string>();
  for (const row of rows) {
    if (typeof row.id !== 'string' || !scope.candidates.has(row.id)) continue;
    const record = decodeAgentMemoryRecord(row.record_json);
    const owner = JSON.stringify(
      record.meta.namespace === undefined ? [] : record.meta.namespace,
    );
    if (
      record.id === row.id &&
      owner === scope.namespaceIdentity &&
      referencesAnySource(record, sources)
    )
      result.add(record.id);
  }
  return result;
}
