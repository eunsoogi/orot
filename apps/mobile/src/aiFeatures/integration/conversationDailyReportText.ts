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
import type { ConversationReport } from '../../ragConversation/conversationReportTemplate';
import type { DailyReportLookup } from '../../storage/dailyReportStorageTypes';
import { formatDateTime, t } from '../../i18n';

/** Assemble the display structure from validated fields, never from prose markers. */
export function dailyReportPresentation(
  saved: Extract<DailyReportLookup, { status: 'saved' }>,
): ConversationReport {
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
  const sections: { title: string; content: string }[] = [];
  function add(title: string, paragraphs: readonly string[]) {
    if (paragraphs.length)
      sections.push({ title, content: paragraphs.join('\n\n') });
  }
  let claims: string[] = [];
  let heading = t('dailyReport.supportedContext');
  for (const [index, claim] of saved.report.supportedContext.entries()) {
    if (
      claim.section &&
      claim.section !== saved.report.supportedContext[index - 1]?.section
    ) {
      add(heading, claims);
      heading = t(`dailyReport.analysis.${claim.section}`);
      claims = [];
    }
    claims.push(claim.text);
  }
  add(heading, claims);
  add(
    t('dailyReport.observations'),
    saved.report.observations.map(item => item.text),
  );
  add(t('dailyReport.suggestedQuestions'), saved.report.followUpQuestions);
  add(t('dailyReport.coverage.attention'), coverage);

  return {
    title: t('dailyReport.title'),
    introduction: t('dailyReport.reportCutoff', {
      time: formatDateTime(
        new Date(saved.context.generationCutoff),
        saved.context.identity.timeZone,
      ),
    }),
    sections,
  };
}

/** Keep the existing text contract for persisted chat answers. */
export function conversationDailyReportText(
  saved: Extract<DailyReportLookup, { status: 'saved' }>,
) {
  const { title, introduction, sections } = dailyReportPresentation(saved);
  return [
    `# ${title}`,
    introduction,
    ...sections.flatMap(section => [`## ${section.title}`, section.content]),
  ].join('\n\n');
}
