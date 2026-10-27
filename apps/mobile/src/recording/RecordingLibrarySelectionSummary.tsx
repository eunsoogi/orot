import { View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { formatRecordedAt } from './formatRecordedAt';
import { formatRecordingDuration } from './recordingTypes';
import { recordingLibraryStyles as styles } from './RecordingLibraryPanel.styles';
import type { RecordingLibrarySummary } from './recordingLibraryService';

/** Preserves the library's distinct transcript availability and review states in labels. */
function reviewLabel(summary: RecordingLibrarySummary): string {
  switch (summary.transcriptReviewState) {
    case 'notTranscribed':
      return t('recording.library.transcriptNotStarted');
    case 'unreviewed':
      return t('recording.transcript.review.unreviewed');
    case 'needsReview':
      return t('recording.transcript.review.needsReview');
    case 'reviewed':
      return t('recording.transcript.review.reviewed');
    case 'unavailable':
      return t('recording.library.transcriptStatusUnavailable');
  }
}

/** Shows the current library metadata for the source selected before opening review. */
export default function RecordingLibrarySelectionSummary({
  summary,
}: {
  readonly summary: RecordingLibrarySummary;
}) {
  const { source } = summary;
  const title = source.title ?? t('recording.library.untitled');
  const duration =
    summary.durationMs === null
      ? t('recording.library.durationUnavailable')
      : formatRecordingDuration(summary.durationMs);

  return (
    <View
      style={styles.selectionSummary}
      testID="saved-recordings-selection-summary"
    >
      <Text
        accessibilityRole="header"
        style={styles.selectionSummaryTitle}
        testID="saved-recordings-selection-title"
      >
        {title}
      </Text>
      <Text
        style={styles.detailMetadata}
        testID="saved-recordings-selection-date"
      >
        {formatRecordedAt(source.recordedAt)}
      </Text>
      <Text style={styles.copy} testID="saved-recordings-selection-duration">
        {duration}
      </Text>
      <Text
        style={styles.copy}
        testID="saved-recordings-selection-review-state"
      >
        {reviewLabel(summary)}
      </Text>
    </View>
  );
}
