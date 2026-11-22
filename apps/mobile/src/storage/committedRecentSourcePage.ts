import {
  listRecentSourcePage,
  type RecentSourceCursor,
  type RecentSourceRow,
  type SqlDatabase,
} from '@orot/storage';
import {
  acquireIndependentReadEpoch,
  awaitIndependentReadSettlement,
} from './protectedReadEpoch';

// Ordinary sqlite startup mutations can cross the native queue once.
const initialContentionBudgetMs = 1_000;

/** A single indexed read takes a turn on the same queue as protected writes.
 * Return no candidate, rather than a mixed snapshot, when a direct mutation
 * interleaves. Genuine SQL/transaction errors still reject without retry. */
async function tryPage(
  database: SqlDatabase,
  before: RecentSourceCursor | undefined,
  signal?: AbortSignal,
): Promise<readonly RecentSourceRow[] | undefined> {
  const snapshot: {
    epoch?: ReturnType<typeof acquireIndependentReadEpoch>;
    rows?: readonly RecentSourceRow[];
    queryFailed?: boolean;
  } = {};
  try {
    await database.transaction(async tx => {
      if (signal?.aborted) return;
      snapshot.epoch = acquireIndependentReadEpoch(database);
      if (!snapshot.epoch) return;
      try {
        snapshot.rows = await listRecentSourcePage(tx, before);
      } catch {
        // Settle normally; don't roll back an unrelated native dispatch.
        snapshot.queryFailed = true;
      }
    });
    if (snapshot.queryFailed)
      throw new Error('Committed recent sources are unavailable.');
    if (!signal?.aborted && snapshot.epoch?.current()) return snapshot.rows;
  } finally {
    snapshot.epoch?.dispose();
  }
}

/** Defer one first-page admission across a known and bounded startup contention.
 * Do not reuse the old snapshot, retry actual SQLite failures, or outlive the
 * owning tab/route's cancellation. Other metadata streams remain independent. */
export async function readCommittedRecentSourcePage(
  database: SqlDatabase,
  before?: RecentSourceCursor,
  signal?: AbortSignal,
  canRetry?: () => Promise<boolean>,
): Promise<readonly RecentSourceRow[]> {
  if (signal?.aborted) return [];
  const initial = await tryPage(database, before, signal);
  if (initial) return initial;
  if (
    !before &&
    (await awaitIndependentReadSettlement(
      database,
      initialContentionBudgetMs,
      signal,
    )) &&
    !signal?.aborted &&
    (!canRetry || (await canRetry())) &&
    !signal?.aborted
  ) {
    const fresh = await tryPage(database, before, signal);
    if (fresh) return fresh;
  }
  if (signal?.aborted) return [];
  throw new Error('Committed recent sources are unavailable.');
}
