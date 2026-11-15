import { fingerprintConsentSnapshot } from '../../agent/execution/consentFingerprint';
import { createCalendarBridge } from '../../calendar/calendarBridge';
import { readCalendarRangeSnapshot } from '../../calendar/calendarRangeSnapshot';
import type {
  DailyReportContext,
  DailyReportSystemCalendar,
} from '@orot/domain';
import { fingerprint, stableJson } from './evidenceUtils';
import { t } from '../../i18n';
import type { CalendarRangeSnapshot } from '../../calendar/calendarRangeSnapshot';
import type { DailyReportCalendarWindow } from '../../healthEvidence/healthContext/dailyReportWindow';

export type ReportCalendarReader = (
  from: string,
  to: string,
  signal?: AbortSignal,
) => Promise<CalendarRangeSnapshot>;

/** Native permission is observed, never requested as a side effect of generating a report. */
export const readReportCalendar: ReportCalendarReader = async (
  from,
  to,
  signal,
) => {
  return readCalendarRangeSnapshot(createCalendarBridge(), from, to, signal);
};

async function revision(snapshot: CalendarRangeSnapshot) {
  // Only a cryptographic digest leaves this runtime-only raw-title snapshot.
  const digest = await fingerprintConsentSnapshot(
    stableJson({
      range: [snapshot.fromInclusive, snapshot.toExclusive],
      events: snapshot.events,
    }),
  );
  if (!/^[a-f0-9]{64}$/.test(digest))
    throw new Error('Invalid calendar revision.');
  return digest;
}

/** Keep a native change listener alive across the caller's asynchronous storage operation. */
export async function acquireReportCalendarGuard(
  context: Pick<DailyReportContext, 'systemCalendar'>,
  read: ReportCalendarReader = readReportCalendar,
  signal?: AbortSignal,
) {
  const binding = context.systemCalendar;
  if (!binding)
    return {
      isCurrent: () => true,
      revalidate: async (checkSignal?: AbortSignal) => !checkSignal?.aborted,
      dispose: () => {},
    };
  let snapshot: CalendarRangeSnapshot | undefined;
  try {
    snapshot = await read(binding.fromInclusive, binding.toExclusive, signal);
    if (
      (await revision(snapshot)) === binding.revision &&
      (await snapshot.revalidate(signal)) &&
      snapshot.isCurrent()
    )
      return snapshot;
  } catch {
    /* Missing access never proves that retained prose is current. */
  }
  snapshot?.dispose();
  return null;
}

/** Reopening derived prose requires a fresh native read; unavailable access is never "unchanged". */
export async function reportCalendarIsCurrent(
  context: Pick<DailyReportContext, 'systemCalendar'>,
  read: ReportCalendarReader = readReportCalendar,
): Promise<boolean> {
  const guard = await acquireReportCalendarGuard(context, read);
  try {
    return guard?.isCurrent() ?? false;
  } finally {
    guard?.dispose();
  }
}

/** Find potentially relevant title labels locally without asserting personal purpose. A plan is never evidence of attendance. */
export async function prepareReportCalendar(
  calendar: DailyReportCalendarWindow,
  read: ReportCalendarReader = readReportCalendar,
  signal?: AbortSignal,
) {
  const snapshot = await read(
    calendar.interval.fromInclusive,
    calendar.interval.toExclusive,
    signal,
  );
  try {
    const digest = await revision(snapshot);
    if (signal?.aborted || !snapshot.isCurrent())
      throw new Error('Calendar changed during projection.');
    const binding: DailyReportSystemCalendar = {
      ...calendar.interval,
      revision: digest,
      recordId: `system-calendar-${fingerprint(calendar.interval)}`,
    };
    const source = {
      source: 'system_calendar',
      recordId: binding.recordId,
      revision: digest,
      occurrence: {
        startInclusive: calendar.interval.fromInclusive,
        endExclusive: calendar.interval.toExclusive,
      },
      ingestedAt: calendar.generationCutoff,
    };
    const counts = { medical: 0, activity: 0 };
    for (const event of snapshot.events) {
      const status = (event as typeof event & { calendarStatus?: string })
        .calendarStatus;
      if (status === 'canceled') continue;
      const title = event.calendarEventSnapshot.title;
      // Word boundaries avoid English substring matches; even matching labels do not establish personal purpose.
      if (
        /진료|병원|검진|치과|치료|\b(?:doctor|clinic|hospital|dentist|therapy)\b/i.test(
          title,
        )
      )
        counts.medical += 1;
      else if (
        /운동|헬스|수영|달리기|요가|필라테스|\b(?:workout|exercise|gym|swim|yoga|pilates)\b/i.test(
          title,
        )
      )
        counts.activity += 1;
    }
    // Raw titles, calendar identifiers, location and attendees never enter model or saved report text.
    const facts = (['medical', 'activity'] as const)
      .filter(kind => counts[kind] > 0)
      .map(kind => ({
        text: t(`dailyReport.systemCalendar.${kind}`, { count: counts[kind] }),
        modelText: `System calendar titles matching ${kind} labels today: ${counts[kind]}. Title matching does not establish personal health/activity purpose; a matching event could be unrelated work. Tentative/unknown status is possible. This is not evidence of attendance, exercise completion, diagnosis or treatment.`,
        sourceReferences: [
          { source: source.source, recordId: source.recordId },
        ],
      }));
    return {
      binding,
      source,
      facts,
      snapshot,
      revisionKey: stableJson(binding),
    };
  } catch (error) {
    snapshot.dispose();
    throw error;
  }
}
