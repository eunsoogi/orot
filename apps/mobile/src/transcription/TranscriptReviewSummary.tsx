import type { TranscriptEvidenceSegment } from '@orot/domain';
import type { SourceRecord } from '@orot/domain';
import { View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { transcriptEvidenceStyles as styles } from './TranscriptEvidencePanel.styles';

function reviewSummaryLabel(
  segments: readonly TranscriptEvidenceSegment[],
): string {
  // A reviewed first segment must not label unfinished or corrected later segments as reviewed.
  if (segments.some(segment => segment.reviewState.status === 'needs_review'))
    return t('recording.transcript.review.needsReview');
  if (
    segments.length > 0 &&
    segments.every(segment => segment.reviewState.status === 'reviewed')
  )
    return t('recording.transcript.review.reviewed');
  return t('recording.transcript.review.unreviewed');
}

export default function TranscriptReviewSummary({
  source,
  segments,
}: {
  readonly source: SourceRecord;
  readonly segments: readonly TranscriptEvidenceSegment[];
}) {
  return (
    <View style={styles.summary} testID="transcript-summary">
      <Text style={styles.summarySource}>
        {source.title ?? t('recording.transcript.recordingSource')}
      </Text>
      <Text style={styles.summaryTitle} testID="transcript-summary-title">
        {reviewSummaryLabel(segments)}
      </Text>
      <Text style={styles.copy}>{t('recording.transcript.description')}</Text>
    </View>
  );
}
