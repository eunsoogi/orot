import type { DailyReportSourceCoverage } from '@orot/domain';
import { appColors } from '../../layout/appColors';
import { t } from '../../i18n';

type CoverageStatus = DailyReportSourceCoverage['status'];

/** Maps verified input metadata to labels and non-color cues without inferring report success. */
export function isDailyReportRecordSource(source: string): boolean {
  return (
    source === 'health_observation' ||
    source === 'symptom_entry' ||
    source === 'dose_event'
  );
}

export function sourceLabel(value: string) {
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
}

export function sourceSymbol(value: string) {
  switch (value) {
    case 'health_observation':
      return 'heart.fill';
    case 'symptom_entry':
      return 'cross.case';
    case 'dose_event':
      return 'pills';
    case 'calendar':
      return 'calendar';
    case 'report_selection':
      return 'checkmark.square';
    case 'record_conflicts':
      return 'exclamationmark.triangle';
    default:
      return 'doc.text';
  }
}

export function statusLabel(value: CoverageStatus) {
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
      return t('dailyReport.coverage.stateUnknown');
  }
}

export function statusVisual(value: CoverageStatus) {
  switch (value) {
    case 'available':
      return {
        color: appColors.primaryText,
        surface: appColors.primarySoft,
        symbol: 'checkmark.circle.fill',
      };
    case 'empty':
      return {
        color: appColors.secondary,
        surface: appColors.background,
        symbol: 'minus.circle',
      };
    case 'partial':
    case 'stale':
    case 'unknown':
      return {
        color: appColors.warning,
        surface: appColors.warningSurface,
        symbol: 'exclamationmark.circle',
      };
    case 'failed':
      return {
        color: appColors.danger,
        surface: appColors.dangerSurface,
        symbol: 'exclamationmark.triangle.fill',
      };
  }
}

export function syncStatusLabel(item: DailyReportSourceCoverage) {
  switch (item.syncStatus) {
    case 'complete':
      return t('dailyReport.coverage.syncComplete');
    case 'retryable':
      return t('dailyReport.coverage.syncRetryable');
    case 'not_requested':
      return t('dailyReport.coverage.syncNotRequested');
    default:
      return t('dailyReport.status.unknown');
  }
}

export function limitationLabel(code: string) {
  switch (code) {
    case 'partial_day':
      return t('dailyReport.partial');
    case 'snapshot_incomplete':
      return t('dailyReport.limit.partial');
    case 'source_sync_unknown':
      return t('dailyReport.status.unknown');
    case 'source_data_stale':
      return t('dailyReport.status.stale');
    case 'source_query_failed':
      return t('dailyReport.status.failed');
    case 'sync_incomplete':
      return t('dailyReport.coverage.syncRetryable');
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
}
