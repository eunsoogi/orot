import { DailyReportContextSchema } from '@orot/domain';
import type {
  DailyReportContext,
  DailyReportProviderMetadata,
  DailyReportSourceCoverage,
  DailyReportSourceRecord,
} from '@orot/domain';
import type { DailyReportCalendarWindow } from './dailyReportWindow';
import { dailyReportSourceRecordIsAvailable } from './dailyReportWindow';

export interface DailyReportSourceSnapshot {
  readonly revision: string;
  readonly mutationGeneration: number;
  readonly deletionGeneration: number;
  readonly records: readonly DailyReportSourceRecord[];
  readonly coverage: readonly DailyReportSourceCoverage[];
}

/** Both preparation and conversation use this constructor for an explicit request. */
export function createDailyReportContext(
  calendar: DailyReportCalendarWindow,
  sourceSnapshot: DailyReportSourceSnapshot,
  provider: DailyReportProviderMetadata,
): DailyReportContext {
  return DailyReportContextSchema.parse({
    kind: 'daily_report_context',
    schemaVersion: 1,
    identity: calendar.identity,
    interval: calendar.interval,
    generationCutoff: calendar.generationCutoff,
    effectiveCutoff: calendar.effectiveCutoff,
    sourceSnapshot: {
      ...sourceSnapshot,
      records: sourceSnapshot.records.filter(record =>
        dailyReportSourceRecordIsAvailable(record, calendar),
      ),
    },
    provider,
  });
}

/** Corrections and deletions invalidate a saved snapshot through existing generation fences. */
export function dailyReportContextMatchesSourceSnapshot(
  context: DailyReportContext,
  current: Pick<
    DailyReportSourceSnapshot,
    'revision' | 'mutationGeneration' | 'deletionGeneration'
  >,
): boolean {
  return (
    context.sourceSnapshot.revision === current.revision &&
    context.sourceSnapshot.mutationGeneration === current.mutationGeneration &&
    context.sourceSnapshot.deletionGeneration === current.deletionGeneration
  );
}
