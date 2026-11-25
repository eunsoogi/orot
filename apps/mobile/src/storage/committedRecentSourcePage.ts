import { reportRecentSourceFailure } from '../providers/recentSourceFailureDiagnostic';
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

// Cold schema and startup writes can hold the first read queue longer than one second.
// This applies only to a known unsettled owner, never to failed SQL or later pages.
const initialContentionBudgetMs = 2_500;
const maxInitialContentionRetries = 2;

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
    await database
      .transaction(async tx => {
        if (signal?.aborted) return;
        snapshot.epoch = acquireIndependentReadEpoch(database);
        if (!snapshot.epoch) return;
        try {
          snapshot.rows = await listRecentSourcePage(tx, before);
        } catch (error) {
          reportRecentSourceFailure(
            'recent_records_media_query',
            error,
            signal,
          );
          // Settle normally; don't roll back an unrelated native dispatch.
          snapshot.queryFailed = true;
        }
      })
      .catch(error => {
        reportRecentSourceFailure(
          'recent_records_media_settlement',
          error,
          signal,
        );
        throw error;
      });
    if (snapshot.queryFailed)
      throw new Error('Committed recent sources are unavailable.');
    if (!signal?.aborted && snapshot.epoch?.current()) return snapshot.rows;
    reportRecentSourceFailure(
      'recent_records_media_witness',
      undefined,
      signal,
    );
  } finally {
    snapshot.epoch?.dispose();
  }
}

/** Read a fresh first page after bounded startup contention; every admission
 * rechecks the same route. Never reuse a snapshot, retry SQLite errors, or outlive the
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
  const deadline = performance.now() + initialContentionBudgetMs;
  for (
    let attempt = 0;
    !before && attempt < maxInitialContentionRetries && !signal?.aborted;
    attempt++
  ) {
    const remaining = deadline - performance.now();
    if (
      remaining <= 0 ||
      !(await awaitIndependentReadSettlement(database, remaining, signal)) ||
      signal?.aborted ||
      (canRetry && !(await canRetry())) ||
      signal?.aborted ||
      performance.now() >= deadline
    )
      break;
    const fresh = await tryPage(database, before, signal);
    if (fresh) return fresh;
  }
  if (signal?.aborted) return [];
  throw new Error('Committed recent sources are unavailable.');
}
