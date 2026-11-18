import { render } from '@testing-library/react-native';
import { GeneratedReportContent } from '../GeneratedReportContent';
import { t } from '../../i18n';
import { OMITTED_SUMMARY_CONTENT_NOTE } from '../../diseaseHypotheses/summaryPartialValidation';
import { INCOMPLETE_SUMMARY_EVIDENCE_NOTE } from '../../diseaseHypotheses/summaryPartialEvidence';

/** Reopening a saved result must not lose its field-specific safety review notices. */
test('saved content retains all four review warnings alongside partial and source notices', async () => {
  const ui = await render(
    <GeneratedReportContent
      detail={{
        paragraphs: ['Synthetic saved report'],
        warning: 'Synthetic source warning',
        analysis: {
          hypotheses: [],
          omittedUnsupportedContent: true,
          incompleteEvidence: true,
          savedSummary: {
            status: 'saved',
            id: 'synthetic-summary',
            createdAt: '2026-01-01T00:00:00Z',
            modelName: 'synthetic',
            contentReviewIssues: [
              'prescription',
              'sleep_count',
              'sleep_duration',
              'step_unit',
            ],
          },
        },
      }}
    />,
  );
  for (const [issue, key] of [
    ['prescription', 'summaryHistory.reviewPrescription'],
    ['sleep_count', 'summaryHistory.reviewSleepCount'],
    ['sleep_duration', 'summaryHistory.reviewSleepDuration'],
    ['step_unit', 'summaryHistory.reviewSteps'],
  ] as const) {
    expect(
      ui.getByTestId(`summary-content-review-${issue}`).props.accessibilityRole,
    ).toBe('alert');
    expect(ui.getByText(t(key))).toBeTruthy();
  }
  expect(ui.getByText('Synthetic saved report')).toBeTruthy();
  expect(ui.getByText('Synthetic source warning')).toBeTruthy();
  expect(ui.getByText(OMITTED_SUMMARY_CONTENT_NOTE)).toBeTruthy();
  expect(ui.getByText(INCOMPLETE_SUMMARY_EVIDENCE_NOTE)).toBeTruthy();
});
