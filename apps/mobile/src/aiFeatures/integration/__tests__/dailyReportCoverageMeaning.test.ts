import type { DailyReportSourceCoverage } from '@orot/domain';
import {
  dailyReportCoverageMeaning,
  isDailyReportCoverageWarning,
} from '../dailyReportCoverageMeaning';

const coverage = (
  change: Partial<DailyReportSourceCoverage>,
): DailyReportSourceCoverage => ({
  source: 'health_observation',
  status: 'unknown',
  limitationCodes: ['source_sync_unknown'],
  ...change,
});

test('absent sync metadata does not invent a failed read, complete sync or an empty source', () => {
  const item = Object.freeze(coverage({}));
  expect(dailyReportCoverageMeaning(item)).toBe('unknown');
  expect(isDailyReportCoverageWarning(item)).toBe(false);
  expect(item.syncStatus).toBeUndefined();
  expect(item.status).toBe('unknown');
  expect(item.limitationCodes).toEqual(['source_sync_unknown']);
});

test.each([
  ['personal_baseline', 'observed_days_not_complete_history'],
  ['behavior_history', 'recorded_behavior_not_complete_history'],
])(
  'ordinary %s scope is informational, but actual snapshot truncation remains a warning',
  (source, scope) => {
    const item = coverage({
      source,
      status: 'partial',
      limitationCodes: [scope],
    });
    expect(dailyReportCoverageMeaning(item)).toBe('recorded_scope');
    expect(isDailyReportCoverageWarning(item)).toBe(false);
    const truncated = {
      ...item,
      limitationCodes: [scope, 'snapshot_incomplete'],
    };
    expect(dailyReportCoverageMeaning(truncated)).toBe('partial');
    expect(isDailyReportCoverageWarning(truncated)).toBe(true);
    expect(item.status).toBe('partial'); // Persisted provenance is not rewritten.
  },
);

test.each([
  'snapshot_incomplete',
  'bounded_source_sampling',
  'selected_facts_only',
  'conflicting_records_omitted',
  'medication_names_not_resolved',
  'future_unknown_limit',
])('keeps %s visible even when generic source status is unknown', code => {
  const item = coverage({ limitationCodes: ['source_sync_unknown', code] });
  expect(isDailyReportCoverageWarning(item)).toBe(true);
  expect(dailyReportCoverageMeaning(item)).toBe('partial');
});

test('keeps observed failure, stale source, and retryable sync stronger than generic scope', () => {
  expect(dailyReportCoverageMeaning(coverage({ status: 'failed' }))).toBe(
    'failed',
  );
  expect(dailyReportCoverageMeaning(coverage({ status: 'stale' }))).toBe(
    'stale',
  );
  expect(
    dailyReportCoverageMeaning(coverage({ syncStatus: 'retryable' })),
  ).toBe('partial');
  expect(
    dailyReportCoverageMeaning(
      coverage({ status: 'available', limitationCodes: [] }),
    ),
  ).toBe('available');
  expect(
    dailyReportCoverageMeaning(
      coverage({ status: 'empty', limitationCodes: [] }),
    ),
  ).toBe('empty');
  expect(
    isDailyReportCoverageWarning(
      coverage({
        source: 'personal_baseline',
        status: 'partial',
        limitationCodes: [],
      }),
    ),
  ).toBe(true);
});
