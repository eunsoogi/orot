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
    .map(item => {
      const count = counts?.get(item.source);
      const details = isDailyReportCoverageWarning(item)
        ? [
            statusLabel(dailyReportCoverageMeaning(item)),
            ...new Set(item.limitationCodes.map(limitationLabel)),
          ]
        : [];
      if (count !== undefined)
        details.unshift(t('dailyReport.coverage.count', { count }));
      return details.length
        ? `${sourceLabel(item.source)}: ${details.join('. ')}`
        : '';
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
      ...(claim.section === 'model' && claims[index - 1]?.section !== 'model'
        ? [t('dailyReport.analysis.modelCaution')]
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
    `## ${t('conversationTemplate.daily.scope')}`,
    ...coverage,
    t('dailyReport.reportCaution'),
  ].join('\n\n');
}
