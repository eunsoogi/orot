import type { SqlDatabase } from '@orot/storage';
import type { EvidenceCandidateScope } from '../../healthEvidence/evidenceCandidateScope';
import type { DailyReportCalendarWindow } from '../../healthEvidence/healthContext/dailyReportWindow';
import type { DailyReportSnapshotResult } from '../../healthEvidence/healthContext/dailyReportSnapshotResult';
import { readDailyReportSnapshot } from '../../healthEvidence/healthContext/dailyReportSnapshot';
import { readHealthContextGeneration } from '../../healthEvidence/healthContext/generation';
import { stableJson } from './evidenceUtils';

function admitted(snapshot: DailyReportSnapshotResult) {
  return stableJson({
    ...snapshot,
    sourceSnapshot: {
      ...snapshot.sourceSnapshot,
      revision: null,
      mutationGeneration: null,
    },
  });
}

/** Only the production DB owner can refresh an active generation's proof. The full
 * admitted payload/lineage/coverage and original deletion epoch remain immutable.
 * A changed mutation counter is acceptable only after a fresh, stable read proves
 * exact equivalence. No successful-validation token is reused across reads. */
export function createDailyReportSnapshotRefresh(
  database: SqlDatabase,
  original: DailyReportSnapshotResult,
  calendar: DailyReportCalendarWindow,
  scope: EvidenceCandidateScope,
) {
  const expected = admitted(original);
  const scopeIdentity = stableJson([calendar, scope]);
  const read = async (signal: AbortSignal) => {
    if (signal.aborted || stableJson([calendar, scope]) !== scopeIdentity)
      return null;
    const current = await readDailyReportSnapshot(
      database,
      calendar,
      scope,
      signal,
    );
    // Native direct writes can interleave with a read transaction. Check after its
    // commit, without throwing inside it and rolling back somebody else's write.
    const generation = await readHealthContextGeneration(database);
    if (
      signal.aborted ||
      stableJson([calendar, scope]) !== scopeIdentity ||
      generation.mutationGeneration !==
        current.sourceSnapshot.mutationGeneration ||
      generation.deletionGeneration !==
        current.sourceSnapshot.deletionGeneration
    )
      return null;
    return current;
  };
  return Object.assign(
    async (signal: AbortSignal) => {
      const current = await read(signal);
      return current && admitted(current) === expected ? current : null;
    },
    { read },
  );
}
