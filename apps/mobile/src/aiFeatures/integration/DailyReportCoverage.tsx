import type { DailyReportSourceCoverage } from '@orot/domain';
import { AppText } from '../../layout/AppText';
import { t } from '../../i18n';

/** Coverage is rendered from the saved snapshot, including explicit unknowns and limits. */
export function DailyReportCoverage({
  coverage,
}: {
  readonly coverage: readonly DailyReportSourceCoverage[];
}) {
  const source = (value: string) => {
    switch (value) {
      case 'health_observation':
        return t('dailyReport.source.health');
      case 'symptom_entry':
        return t('dailyReport.source.symptom');
      case 'dose_event':
        return t('dailyReport.source.dose');
      case 'calendar':
        return t('dailyReport.source.calendar');
      case 'report_selection':
        return t('dailyReport.source.selection');
      case 'record_conflicts':
        return t('dailyReport.source.conflict');
      default:
        return t('dailyReport.source.other');
    }
  };
  const status = (value: DailyReportSourceCoverage['status']) => {
    switch (value) {
      case 'available':
        return t('dailyReport.status.available');
      case 'empty':
        return t('dailyReport.status.empty');
      case 'partial':
        return t('dailyReport.status.partial');
      case 'stale':
        return t('dailyReport.status.stale');
      case 'failed':
        return t('dailyReport.status.failed');
      case 'unknown':
        return t('dailyReport.status.unknown');
    }
  };
  const limit = (code: string) => {
    switch (code) {
      case 'partial_day':
        return t('dailyReport.partial');
      case 'snapshot_incomplete':
        return t('dailyReport.limit.partial');
      case 'source_sync_unknown':
        return t('dailyReport.limit.sync');
      case 'medication_names_not_resolved':
        return t('dailyReport.limit.medication');
      case 'selected_facts_only':
        return t('dailyReport.limit.selection');
      case 'conflicting_measurements':
      case 'incomparable_units':
      case 'conflicting_records_omitted':
        return t('dailyReport.limit.conflict');
      default:
        return t('dailyReport.limit.other');
    }
  };
  return (
    <>
      {coverage.map((item, index) => (
        <AppText key={`${item.source}:${index}`}>
          {t('dailyReport.coverageLine', {
            source: source(item.source),
            status: status(item.status),
          })}
          {'\n'}
          {[...new Set(item.limitationCodes.map(limit))].join('\n')}
          {item.availableThrough || item.lastSuccessfulAt
            ? `\n${t('dailyReport.sourceTime', { time: item.availableThrough ?? item.lastSuccessfulAt! })}`
            : ''}
        </AppText>
      ))}
    </>
  );
}
