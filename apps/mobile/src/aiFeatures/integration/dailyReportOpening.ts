import { reportOpening } from './openingObservation';
import { withConcurrentConversationOpening } from './concurrentConversationOpening';
import { startContextualConversationOpening } from './contextualConversationOpening';
import type {
  DailyReportRunInput,
  DailyReportServiceRequest,
} from './dailyReportTypes';
import type { SelectedAiResolution } from './provider';

/** Only a live conversation receives a model-authored opening. Source preparation has
 * succeeded; reuse/lookup never calls this. No health facts or report text enter its payload.
 * The existing outer report deadline and Stop still bound this optional two-call preview. */
export async function generateDailyReportOpening(
  input: DailyReportRunInput,
  request: DailyReportServiceRequest,
  selected: Extract<SelectedAiResolution, { status: 'ready' }>,
  includesSystemCalendar: boolean,
) {
  if (!request.observer?.onTaskStreamEvent || request.signal.aborted) return;
  const opening = startContextualConversationOpening({
    selected,
    request: '오늘의 일일 보고서를 만들어 주세요.',
    observer: request.observer,
    consent: input.consent,
    signal: request.signal,
    diagnosticFeature: 'daily_report',
    allowedScope: { sourceKinds: ['personal_record'] },
    consentScope: {
      purpose: 'daily_report',
      dataCategories: [
        'health_records',
        ...(includesSystemCalendar ? ['calendar_plans'] : []),
      ],
      policyVersion: includesSystemCalendar
        ? 'daily-report-calendar-analysis-v2'
        : 'daily-report-analysis-v2',
    },
  });
  try {
    await opening.done;
  } finally {
    opening.dispose();
  }
}

/** Shares the existing opening contract and exact consent port with report generation.
 * The final model can run concurrently; completion cannot overtake an accepted opening. */
export function withDailyReportOpening<T>(
  input: DailyReportRunInput,
  request: DailyReportServiceRequest,
  selected: Extract<SelectedAiResolution, { status: 'ready' }>,
  includesSystemCalendar: boolean,
  run: (consent: DailyReportRunInput['consent']) => Promise<T>,
): Promise<T> {
  if (!request.observer?.onTaskStreamEvent) return run(input.consent);
  return withConcurrentConversationOpening({
    consent: input.consent,
    signal: request.signal,
    open: (consent, signal) =>
      generateDailyReportOpening(
        { ...input, consent },
        { ...request, signal },
        selected,
        includesSystemCalendar,
      ),
    run,
    onTimeout: () =>
      reportOpening('opening_delivery', 'timeout', 'daily_report'),
  });
}
