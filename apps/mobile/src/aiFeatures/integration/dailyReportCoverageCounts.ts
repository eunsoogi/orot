import type { DailyReportSourceRecord } from '@orot/domain';

/** Count query-backed records only; absent snapshots stay unknown and sync/freshness remain separate. */
export function dailyReportCoverageCounts(
  records: readonly DailyReportSourceRecord[],
): ReadonlyMap<string, number>;
export function dailyReportCoverageCounts(records: undefined): undefined;
export function dailyReportCoverageCounts(
  records: readonly DailyReportSourceRecord[] | undefined,
): ReadonlyMap<string, number> | undefined;
export function dailyReportCoverageCounts(
  records: readonly DailyReportSourceRecord[] | undefined,
): ReadonlyMap<string, number> | undefined {
  if (!records) return undefined;

  const counts = new Map<string, number>();
  for (const record of records) {
    const source =
      record.contextRole === 'personal_baseline'
        ? 'personal_baseline'
        : record.source;
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  return counts;
}
