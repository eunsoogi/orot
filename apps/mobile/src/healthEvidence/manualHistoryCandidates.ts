import type { ManualHistoryEvidence, ManualHistoryQuery } from '@orot/domain';
import type { ManualHistoryRepository } from '@orot/storage';
import type { EvidenceCandidateScope } from './evidenceCandidateScope';

const MAX_MANUAL_HISTORY_CANDIDATES = 40;
const MANUAL_HISTORY_QUERY_LIMIT = 13;

export interface ManualHistoryCandidateSelection {
  readonly candidates: readonly ManualHistoryEvidence[];
  readonly hasMoreCandidates: boolean;
}

function dateQuery(
  scope?: EvidenceCandidateScope,
): Pick<
  ManualHistoryQuery,
  'dateStatus' | 'effectiveDateFrom' | 'effectiveDateThrough'
> {
  if (!scope?.timeRange) return {};
  const from = Date.parse(scope.timeRange.fromInclusive);
  const to = Date.parse(scope.timeRange.toExclusive);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    throw new RangeError('Evidence time range must advance.');
  }
  return {
    dateStatus: 'known',
    effectiveDateFrom: new Date(from).toISOString().slice(0, 10),
    effectiveDateThrough: new Date(to - 1).toISOString().slice(0, 10),
  };
}

function dateOverlapsRange(
  entry: ManualHistoryEvidence,
  scope?: EvidenceCandidateScope,
): boolean {
  if (!scope?.timeRange) return true;
  if (entry.effectiveDate.status !== 'known') return false;
  const start = Date.parse(`${entry.effectiveDate.date}T00:00:00.000Z`);
  const end = start + 24 * 60 * 60 * 1000;
  const from = Date.parse(scope.timeRange.fromInclusive);
  const to = Date.parse(scope.timeRange.toExclusive);
  return end > from && start < to;
}

function queryTerms(query: string): string[] {
  const terms = query.normalize('NFKC').match(/[\p{L}\p{M}\p{N}]{2,}/gu) ?? [];
  return [...new Set(terms)].slice(0, 3).map(term => term.slice(0, 64));
}

/** Reads a small current-only window, with matching older entries alongside recent entries. */
export async function readManualHistoryCandidates(
  repository: ManualHistoryRepository,
  query: string,
  signal: AbortSignal | undefined,
  scope?: EvidenceCandidateScope,
): Promise<ManualHistoryCandidateSelection> {
  if (signal?.aborted)
    throw new Error('The local evidence request was cancelled.');
  if (scope?.selection === 'health_overview')
    return { candidates: [], hasMoreCandidates: false };

  const range = dateQuery(scope);
  let candidates: ManualHistoryEvidence[] = [];
  let hasMoreCandidates = false;
  if (scope?.sourceIds) {
    const ids = [...new Set(scope.sourceIds)];
    hasMoreCandidates = ids.length > MAX_MANUAL_HISTORY_CANDIDATES;
    candidates = (
      await Promise.all(
        ids
          .slice(0, MAX_MANUAL_HISTORY_CANDIDATES)
          .map(id => repository.getEvidence(id)),
      )
    ).filter(
      (entry): entry is ManualHistoryEvidence =>
        entry !== null && dateOverlapsRange(entry, scope),
    );
  } else {
    const recent = await repository.listEvidence({
      ...range,
      limit: MAX_MANUAL_HISTORY_CANDIDATES + 1,
    });
    const terms = queryTerms(query);
    const matching = await Promise.all(
      terms.map(search =>
        repository.listEvidence({
          ...range,
          search,
          limit: MANUAL_HISTORY_QUERY_LIMIT,
        }),
      ),
    );
    hasMoreCandidates =
      recent.length > MAX_MANUAL_HISTORY_CANDIDATES ||
      matching.some(entries => entries.length >= MANUAL_HISTORY_QUERY_LIMIT);
    const byId = new Map<string, ManualHistoryEvidence>();
    for (const entries of matching) {
      for (const entry of entries) byId.set(entry.sourceEntryId, entry);
    }
    for (const entry of recent) byId.set(entry.sourceEntryId, entry);
    candidates = [...byId.values()].slice(0, MAX_MANUAL_HISTORY_CANDIDATES);
    hasMoreCandidates ||= byId.size > MAX_MANUAL_HISTORY_CANDIDATES;
  }

  if (signal?.aborted)
    throw new Error('The local evidence request was cancelled.');
  return { candidates, hasMoreCandidates };
}
