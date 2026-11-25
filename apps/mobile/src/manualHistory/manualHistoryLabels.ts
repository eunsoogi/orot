import { t } from '../i18n';
import type { ManualHistoryScreenRecord } from './types';

/** Reuse the original record's own trust and effective date in legacy and unified surfaces. */
export function manualHistoryReviewLabel(
  entry: ManualHistoryScreenRecord,
): string {
  const reviewKey = ('manualHistory.review.' + entry.reviewState.status) as
    | 'manualHistory.review.unreviewed'
    | 'manualHistory.review.needs_review'
    | 'manualHistory.review.reviewed';
  return t('manualHistory.status', { review: t(reviewKey) });
}

export function manualHistoryEffectiveDateLabel(
  effectiveDate: ManualHistoryScreenRecord['effectiveDate'],
): string {
  return effectiveDate.status === 'known'
    ? t('manualHistory.date.known', { date: effectiveDate.date })
    : t('manualHistory.date.unknown');
}
