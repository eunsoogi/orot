import {
  dailyReportCoverageMeaning,
  isDailyReportCoverageWarning,
} from './dailyReportCoverageMeaning';
import {
  sourceLabel,
  limitationLabel,
  statusLabel,
} from './dailyReportCoveragePresentation';
import { dailyReportCoverageCounts } from './dailyReportCoverageCounts';
import type { DailyReportLookup } from '../../storage/dailyReportStorageTypes';
import { formatDateTime, t } from '../../i18n';

/** Preserve the saved model's prose and ordering in both live and restored chat turns. */
export function conversationDailyReportText(
  saved: Extract<DailyReportLookup, { status: 'saved' }>,
) {
  const counts = dailyReportCoverageCounts(
    saved.context.sourceSnapshot?.records,
  );
  const coverage = saved.report.coverage
    .filter(isDailyReportCoverageWarning)
    .map(item => {
      const meaning = dailyReportCoverageMeaning(item);
      // The cutoff and deliberate scope exclusions are provenance, not warnings.
      const codes = item.limitationCodes.filter(
        code =>
          code !== 'partial_day' &&
          code !== 'selected_facts_only' &&
          code !== 'planned_events_not_attendance',
      );
      if (
        meaning === 'partial' &&
        item.syncStatus !== 'retryable' &&
        item.limitationCodes.length > 0 &&
        codes.length === 0
      )
        return '';
      const count = counts?.get(item.source);
      // The old ambiguous calendar status proves non-inclusion, not a partial read.
      const unknownCalendar =
        item.source === 'system_calendar' &&
        item.status === 'unknown' &&
        item.syncStatus !== 'retryable' &&
        codes.some(
          code =>
            code === 'calendar_unavailable_or_scoped_out' ||
            code === 'calendar_read_unavailable',
        );
      const details = [
        ...(unknownCalendar ? [] : [statusLabel(meaning)]),
        ...new Set(codes.map(limitationLabel)),
      ];
      if (count !== undefined)
        details.unshift(t('dailyReport.coverage.count', { count }));
      return `${sourceLabel(item.source)}: ${[...new Set(details)].join('. ')}`;
    })
    .filter(Boolean);
  return [
    `# ${t('dailyReport.title')}`,
    t('dailyReport.reportCutoff', {
      time: formatDateTime(
        new Date(saved.context.generationCutoff),
        saved.context.identity.timeZone,
      ),
    }),
    ...(saved.report.supportedContext.length &&
    !saved.report.supportedContext[0]?.section
      ? [`## ${t('dailyReport.supportedContext')}`]
      : []),
    ...saved.report.supportedContext.flatMap((claim, index, claims) => [
      ...(claim.section && claim.section !== claims[index - 1]?.section
        ? [`## ${t(`dailyReport.analysis.${claim.section}`)}`]
        : []),
      claim.text,
    ]),
    ...(saved.report.observations.length
      ? [
          `## ${t('dailyReport.observations')}`,
          ...saved.report.observations.map(item => item.text),
        ]
      : []),
    ...(saved.report.followUpQuestions.length
      ? [
          `## ${t('dailyReport.suggestedQuestions')}`,
          ...saved.report.followUpQuestions,
        ]
      : []),
    ...(coverage.length
      ? [`## ${t('dailyReport.coverage.attention')}`, ...coverage]
      : []),
  ].join('\n\n');
}
