import type { DailyReportSourceRecord } from '@orot/domain';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import type { DailyReportLineage } from '../../storage/dailyReportStorageTypes';
import type { DailyReportSnapshotResult } from './dailyReportSnapshotResult';

export type SnapshotRevisionInput = Readonly<{
  record: Omit<DailyReportSourceRecord, 'revision'>;
  lineage: Omit<DailyReportLineage, 'revision'>;
  payload: Readonly<Record<string, unknown>>;
}>;
type SnapshotWithoutRevision = Omit<
  DailyReportSnapshotResult,
  'sourceSnapshot'
> & {
  sourceSnapshot: Omit<DailyReportSnapshotResult['sourceSnapshot'], 'revision'>;
};

const revisionsPerTurn = 32;

function requireCurrent(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Daily report snapshot cancelled.');
}

/** Only detached, owned JSON and previously validated historical values cross
 * settlement. Keeping canonical serialization here avoids holding the database
 * transaction for CPU work; revision and eventual provider reproof stay exact. */
export async function finishDailyReportSnapshot(
  snapshot: SnapshotWithoutRevision,
  revisions: readonly SnapshotRevisionInput[],
  signal?: AbortSignal,
): Promise<DailyReportSnapshotResult> {
  const records: DailyReportSourceRecord[] = [];
  const lineage: DailyReportLineage[] = [];
  for (const [index, pending] of revisions.entries()) {
    if (revisions.length >= revisionsPerTurn && index % revisionsPerTurn === 0)
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    requireCurrent(signal);
    const revision = fingerprint(pending.payload);
    records.push({ ...pending.record, revision });
    lineage.push({ ...pending.lineage, revision });
  }
  const { records: history, coverage, ...generation } = snapshot.sourceSnapshot;
  records.push(...history);
  lineage.push(...snapshot.lineage);
  requireCurrent(signal);
  return {
    ...snapshot,
    lineage,
    sourceSnapshot: {
      ...generation,
      revision: fingerprint([generation, records]),
      records,
      coverage,
    },
  };
}
