import type { DailyReportIdentity } from '@orot/domain';
import type { SqlDatabase } from '@orot/storage';
import {
  createDailyReportCalendarWindow,
  currentDailyReportContextRequest,
} from '../../healthEvidence/healthContext/dailyReportWindow';
import { readDailyReportSnapshot } from '../../healthEvidence/healthContext/dailyReportSnapshot';
import { dailyReportCoverageCounts } from './dailyReportCoverageCounts';

/** Preparation reads local records only; it never resolves a provider or invokes AI. */
export async function previewDailyReport(input: {
  identity: DailyReportIdentity;
  now: string;
  openDatabase: () => Promise<SqlDatabase>;
  signal: AbortSignal;
  currentTimeZone?: string;
}) {
  const request = currentDailyReportContextRequest(
    input.now,
    input.currentTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  if (request.status !== 'ready') return { status: 'error' as const };
  const window = createDailyReportCalendarWindow(request.request);
  if (
    window.status !== 'ready' ||
    window.context.identity.key !== input.identity.key
  )
    return { status: 'not_today' as const };
  try {
    const db = await input.openDatabase();
    if (input.signal.aborted) return { status: 'cancelled' as const };
    const snapshot = await readDailyReportSnapshot(
      db,
      window.context,
      {},
      input.signal,
    );
    if (input.signal.aborted) return { status: 'cancelled' as const };
    return {
      status: 'ready' as const,
      cutoff: window.context.generationCutoff,
      timeZone: window.context.identity.timeZone,
      partial: window.context.partial,
      count: snapshot.values.length,
      coverage: snapshot.sourceSnapshot.coverage,
      sourceCounts: dailyReportCoverageCounts(snapshot.sourceSnapshot.records),
      latestSourceTime: snapshot.sourceSnapshot.records.reduce<string | null>(
        (latest, record) =>
          !latest ||
          Date.parse(record.occurrence.startInclusive) > Date.parse(latest)
            ? record.occurrence.startInclusive
            : latest,
        null,
      ),
    };
  } catch {
    return {
      status: input.signal.aborted
        ? ('cancelled' as const)
        : ('error' as const),
    };
  }
}
