import { isRecordKind } from '@orot/storage';
import type { DailyReportContext } from '@orot/domain';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import type { DailyReportLineage } from './dailyReportStorageTypes';

/** Reject incomplete or malformed bindings before exposing or retaining report text. */
export function parseDailyReportLineage(
  context: DailyReportContext,
  value: unknown,
): DailyReportLineage[] | null {
  if (!Array.isArray(value)) return null;
  const lineage: DailyReportLineage[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (
      typeof row.source !== 'string' ||
      !row.source.trim() ||
      typeof row.recordId !== 'string' ||
      !row.recordId.trim() ||
      typeof row.localId !== 'string' ||
      !row.localId.trim() ||
      typeof row.revision !== 'string' ||
      !row.revision.trim() ||
      typeof row.kind !== 'string' ||
      !(
        isRecordKind(row.kind) ||
        row.kind === 'manual_history' ||
        row.kind === 'reviewed_memory'
      )
    )
      return null;
    lineage.push({
      source: row.source,
      recordId: row.recordId,
      localId: row.localId,
      revision: row.revision,
      kind: row.kind,
    });
  }
  const expected = context.sourceSnapshot.records
    .map(row => stableJson([row.source, row.recordId, row.revision]))
    .sort();
  const actual = lineage
    .map(row => stableJson([row.source, row.recordId, row.revision]))
    .sort();
  return stableJson(expected) === stableJson(actual) ? lineage : null;
}
