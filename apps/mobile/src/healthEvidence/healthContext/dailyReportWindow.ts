import {
  compareTimestamps,
  dailyReportCalendarInterval,
  createDailyReportIdentity,
  DailyReportContextRequestSchema,
  DailyReportTimeZoneSchema,
  TimestampSchema,
} from '@orot/domain';
import type {
  DailyReportContextRequest,
  DailyReportIdentity,
  DailyReportSourceRecord,
} from '@orot/domain';
import { dateKey, dayFormatter } from './calendarDate';
import type { HealthContextWindow } from './types';

export interface DailyReportCalendarWindow {
  readonly identity: DailyReportIdentity;
  /** Exact local civil-day bounds; dataWindow is clipped to the explicit request time. */
  readonly interval: {
    readonly fromInclusive: string;
    readonly toExclusive: string;
  };
  readonly generationCutoff: string;
  readonly effectiveCutoff: string;
  readonly dataWindow: HealthContextWindow | null;
  readonly partial: boolean;
}

export type DailyReportCalendarErrorCode =
  'invalid_request' | 'nonexistent_local_day' | 'cutoff_before_day';

export type DailyReportCalendarResult =
  | { readonly status: 'ready'; readonly context: DailyReportCalendarWindow }
  | {
      readonly status: 'error';
      readonly code: DailyReportCalendarErrorCode;
    };

export type DailyReportCurrentRequestResult =
  | { readonly status: 'ready'; readonly request: DailyReportContextRequest }
  | { readonly status: 'error'; readonly code: 'invalid_request' };

/** New requests use the caller's current IANA zone; callers must supply it explicitly. */
export function currentDailyReportContextRequest(
  requestedAt: string,
  timeZone: string,
): DailyReportCurrentRequestResult {
  if (
    !TimestampSchema.safeParse(requestedAt).success ||
    !DailyReportTimeZoneSchema.safeParse(timeZone).success
  )
    return { status: 'error', code: 'invalid_request' };
  const formatter = dayFormatter(timeZone);
  const request = {
    localDate: dateKey(formatter, Date.parse(requestedAt)),
    timeZone: formatter.resolvedOptions().timeZone,
    requestedAt,
  };
  const parsed = DailyReportContextRequestSchema.safeParse(request);
  return parsed.success
    ? { status: 'ready', request: parsed.data }
    : { status: 'error', code: 'invalid_request' };
}

/** Build one explicit local day and clamp only the data end, retaining the actual request time. */
export function createDailyReportCalendarWindow(
  input: unknown,
): DailyReportCalendarResult {
  const parsed = DailyReportContextRequestSchema.safeParse(input);
  if (!parsed.success) return { status: 'error', code: 'invalid_request' };
  const request: DailyReportContextRequest = parsed.data;
  const formatter = dayFormatter(request.timeZone);
  const timeZone = formatter.resolvedOptions().timeZone;
  const interval = dailyReportCalendarInterval(request.localDate, timeZone);
  if (!interval) return { status: 'error', code: 'nonexistent_local_day' };

  const { fromInclusive, toExclusive } = interval;
  if (compareTimestamps(request.requestedAt, fromInclusive) < 0)
    return { status: 'error', code: 'cutoff_before_day' };
  const effectiveCutoff =
    compareTimestamps(request.requestedAt, toExclusive) < 0
      ? request.requestedAt
      : toExclusive;
  const dataWindow =
    compareTimestamps(effectiveCutoff, fromInclusive) === 0
      ? null
      : {
          fromInclusive,
          toExclusive: effectiveCutoff,
          timeZone,
          dataAvailableThrough: request.requestedAt,
        };

  return {
    status: 'ready',
    context: {
      identity: createDailyReportIdentity(request.localDate, timeZone),
      interval: { fromInclusive, toExclusive },
      generationCutoff: request.requestedAt,
      effectiveCutoff,
      dataWindow,
      partial: compareTimestamps(effectiveCutoff, toExclusive) < 0,
    },
  };
}

/** Occurrence selects the local day; ingestion time only limits what existed at the cutoff. */
export function dailyReportSourceRecordIsAvailable(
  record: DailyReportSourceRecord,
  context: DailyReportCalendarWindow,
): boolean {
  if (
    !context.dataWindow ||
    compareTimestamps(record.ingestedAt, context.generationCutoff) > 0
  )
    return false;
  const { startInclusive, endExclusive } = record.occurrence;
  if (endExclusive)
    return (
      compareTimestamps(startInclusive, context.effectiveCutoff) < 0 &&
      compareTimestamps(endExclusive, context.interval.fromInclusive) > 0
    );
  return (
    compareTimestamps(startInclusive, context.interval.fromInclusive) >= 0 &&
    compareTimestamps(startInclusive, context.effectiveCutoff) < 0
  );
}
