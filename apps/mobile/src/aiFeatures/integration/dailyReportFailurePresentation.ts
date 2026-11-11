import { t } from '../../i18n';
import type { DailyReportFailureCode } from './dailyReportTypes';

/** Maps closed stage codes to local guidance without treating every failure as missing records. */
export function dailyReportFailureMessage(
  code: DailyReportFailureCode,
  hasSavedReport: boolean,
) {
  switch (code) {
    case 'source_read_failed':
      return t('dailyReport.failure.sourceRead');
    case 'source_unavailable':
      return t('dailyReport.failure.sourceUnavailable');
    case 'report_read_failed':
      return t('dailyReport.lookupError');
    case 'day_changed':
    case 'not_today':
      return t('dailyReport.failure.dayChanged');
    case 'provider_unavailable':
    case 'partial_stream':
    case 'timeout':
      return t('dailyReport.failure.provider');
    case 'consent_required':
      return t('dailyReport.failure.consent');
    case 'malformed_output':
      return t('dailyReport.failure.validation');
    case 'persistence_failed':
      return t(
        hasSavedReport
          ? 'dailyReport.failure.persistencePrevious'
          : 'dailyReport.failure.persistence',
      );
    case 'cancelled':
      return t('dailyReport.cancelled');
    case 'source_stale':
      return t('dailyReport.stale');
    case 'source_revision_changed':
      return t('dailyReport.sourceError');
    default:
      return t('dailyReport.failure');
  }
}
