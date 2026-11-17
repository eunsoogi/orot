import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import type { DiseaseHypothesisAnalysis } from './types';

/** Existing content-review warnings are distinct from the content-free quarantine state. */
export function SavedSummaryReviewWarnings({
  current,
}: {
  current?: DiseaseHypothesisAnalysis['savedSummary'];
}) {
  return (
    <>
      {current?.status === 'saved'
        ? current.contentReviewIssues?.map(issue => (
            <AppText
              key={issue}
              accessibilityRole="alert"
              testID={`summary-content-review-${issue}`}
            >
              {issue === 'prescription'
                ? t('summaryHistory.reviewPrescription')
                : issue === 'sleep_count'
                  ? t('summaryHistory.reviewSleepCount')
                  : issue === 'sleep_duration'
                    ? t('summaryHistory.reviewSleepDuration')
                    : t('summaryHistory.reviewSteps')}
            </AppText>
          ))
        : null}
    </>
  );
}
