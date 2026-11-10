import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';

class DailyReportSaveCancelled extends Error {}

export type DailyReportSaveStatus =
  'saved' | 'reused' | 'stale' | 'deleted' | 'error' | 'cancelled';

/** Throw inside the transaction so cancellation rolls back all writes. */
export function checkDailyReportSaveCancellation(signal?: AbortSignal) {
  if (signal?.aborted) throw new DailyReportSaveCancelled();
}

export function dailyReportSaveFailure(error: unknown): DailyReportSaveStatus {
  return error instanceof DailyReportSaveCancelled
    ? 'cancelled'
    : error instanceof RetainedSourceInvalidError
      ? 'stale'
      : 'error';
}
