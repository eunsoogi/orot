import { reportRecentSourceFailure } from '../providers/recentSourceFailureDiagnostic';
import { BoundReadRevisionChanged } from './boundReadResultWitness';
import {
  listRecentSourcePage,
  type RecentSourceCursor,
  type RecentSourceRow,
  type SqlDatabase,
} from '@orot/storage';
import {
  acquireIndependentReadEpoch,
  awaitIndependentReadSettlementResult,
} from './protectedReadEpoch';
import { reportRecentMediaAdmission } from '../providers/recentMediaAdmissionDiagnostic';

// Cold schema and startup writes can hold the first read queue longer than one second.
// This applies only to a known unsettled owner, never to failed SQL or later pages.
const initialContentionBudgetMs = 2_500;
const maxInitialContentionRetries = 4;

/** A single indexed read takes a turn on the same queue as protected writes.
 * Return no candidate, rather than a mixed snapshot, when a direct mutation
 * interleaves. Genuine SQL/transaction errors still reject without retry. */
async function tryPage(
  database: SqlDatabase,
  before: RecentSourceCursor | undefined,
  signal?: AbortSignal,
): Promise<
  | { readonly rows: readonly RecentSourceRow[] }
  | { readonly missing: 'missing_witness' | 'revision_changed' }
> {
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
    if (!signal?.aborted && snapshot.epoch?.current() && snapshot.rows)
      return { rows: snapshot.rows };
    reportRecentSourceFailure(
      'recent_records_media_witness',
      snapshot.epoch ? new BoundReadRevisionChanged() : undefined,
      signal,
    );
    return { missing: snapshot.epoch ? 'revision_changed' : 'missing_witness' };
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
  if ('rows' in initial) return initial.rows;
  let missing = initial.missing;
  const deadline = performance.now() + initialContentionBudgetMs;
  const report = (outcome: Parameters<typeof reportRecentMediaAdmission>[1]) =>
    reportRecentMediaAdmission(before ? 'next_page' : 'first_page', outcome);
  const stop = (
    outcome: Parameters<typeof reportRecentMediaAdmission>[1],
  ): readonly RecentSourceRow[] => {
    if (signal?.aborted) {
      report('cancelled');
      return [];
    }
    report(outcome);
    throw new Error('Committed recent sources are unavailable.');
  };
  // A cursor from an earlier page cannot be moved on a replacement epoch.
  if (before) return stop(missing);
  for (
    let attempt = 0;
    attempt < maxInitialContentionRetries && !signal?.aborted;
    attempt++
  ) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) return stop('budget_expired');
    const settle = await awaitIndependentReadSettlementResult(
      database,
      remaining,
      signal,
    );
    if (settle !== 'settled') return stop(settle);
    if (signal?.aborted) return stop('cancelled');
    if (canRetry && !(await canRetry())) return stop('readmission_refused');
    if (signal?.aborted) return stop('cancelled');
    if (performance.now() >= deadline) return stop('budget_expired');
    const fresh = await tryPage(database, before, signal);
    if ('rows' in fresh) {
      report('recovered');
      return fresh.rows;
    }
    missing = fresh.missing;
  }
  return stop(
    missing === 'revision_changed'
      ? 'cap_revision_changed'
      : 'cap_missing_witness',
  );
}
