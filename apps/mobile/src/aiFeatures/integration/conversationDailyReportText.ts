import { dailyReportCoverageMeaning } from './dailyReportCoverageMeaning';
import {
  sourceLabel,
  limitationLabel,
  statusLabel,
} from './dailyReportCoveragePresentation';
import { dailyReportEmptyActivity } from './dailyReportEmptyActivity';
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
  const coverage = saved.report.coverage.flatMap(item => {
    const meaning = dailyReportCoverageMeaning(item);
    // A concrete failed or stale source is not a generic data-sufficiency judgement.
    if (meaning !== 'failed' && meaning !== 'stale') return [];
    const count = counts?.get(item.source);
    const details = [
      ...(count === undefined
        ? []
        : [t('dailyReport.coverage.count', { count })]),
      statusLabel(meaning),
      ...item.limitationCodes
        .filter(code =>
          ['source_query_failed', 'source_data_stale'].includes(code),
        )
        .map(limitationLabel),
    ];
    return [`${sourceLabel(item.source)}: ${[...new Set(details)].join('. ')}`];
  });
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
  add(t('dailyReport.observations'), [
    ...dailyReportEmptyActivity(saved.report.coverage),
    ...saved.report.observations.map(item => item.text),
  ]);
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
