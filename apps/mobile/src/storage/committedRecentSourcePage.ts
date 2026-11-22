import {
  listRecentSourcePage,
  type RecentSourceCursor,
  type RecentSourceRow,
  type SqlDatabase,
} from '@orot/storage';
import { acquireIndependentReadEpoch } from './protectedReadEpoch';

/** The native transaction queue waits for earlier file/audio writes or rollback.
 * Only one indexed metadata SELECT takes the same handle's bounded read turn. */
export async function readCommittedRecentSourcePage(
  database: SqlDatabase,
  before?: RecentSourceCursor,
): Promise<readonly RecentSourceRow[]> {
  const snapshot: {
    epoch?: ReturnType<typeof acquireIndependentReadEpoch>;
    rows?: readonly RecentSourceRow[];
  } = {};
  try {
    await database.transaction(async tx => {
      // At this point the queue has settled prior transactions. A direct,
      // unqueued mutation or unsettled owner still invalidates the snapshot.
      snapshot.epoch = acquireIndependentReadEpoch(database);
      if (!snapshot.epoch) return;
      try {
        snapshot.rows = await listRecentSourcePage(tx, before);
      } catch {
        // Settle the read transaction normally before reporting failure. Do not
        // roll back a separate native dispatch that might have invalidated it.
      }
    });
    if (!snapshot.rows || !snapshot.epoch?.current())
      throw new Error('Committed recent sources are unavailable.');
    return snapshot.rows;
  } finally {
    snapshot.epoch?.dispose();
  }
}
