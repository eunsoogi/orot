import { Pressable, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { formatRecordedAt } from './formatRecordedAt';
import { formatRecordingDuration } from './recordingTypes';
import { recordingLibraryStyles as styles } from './RecordingLibraryPanel.styles';
import type { RecordingLibrarySummary } from './recordingLibraryService';

interface RecordingLibrarySummaryRowProps {
  readonly summary: RecordingLibrarySummary;
  readonly disabled: boolean;
  readonly onOpen: () => void;
  readonly onPlay: () => void;
  readonly onDelete: () => void;
}

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

function reviewStyle(summary: RecordingLibrarySummary) {
  if (summary.transcriptReviewState === 'reviewed') {
    return [styles.reviewBadge, styles.reviewComplete];
  }
  if (
    summary.transcriptReviewState === 'unreviewed' ||
    summary.transcriptReviewState === 'needsReview'
  ) {
    return [styles.reviewBadge, styles.reviewNeeds];
  }
  return [styles.reviewBadge, styles.reviewUnavailable];
}

function reviewTextStyle(summary: RecordingLibrarySummary) {
  if (summary.transcriptReviewState === 'reviewed') {
    return styles.reviewCompleteText;
  }
  if (
    summary.transcriptReviewState === 'unreviewed' ||
    summary.transcriptReviewState === 'needsReview'
  ) {
    return styles.reviewNeedsText;
  }
  return styles.reviewUnavailableText;
}

/** Keeps metadata with the row while offering separate open, play, and delete actions. */
export default function RecordingLibrarySummaryRow({
  summary,
  disabled,
  onOpen,
  onPlay,
  onDelete,
}: RecordingLibrarySummaryRowProps) {
  const { source } = summary;
  const title = source.title ?? t('recording.library.untitled');
  const recordedAt = formatRecordedAt(source.recordedAt);
  const duration =
    summary.durationMs === null
      ? t('recording.library.durationUnavailable')
      : formatRecordingDuration(summary.durationMs);
  const review = reviewLabel(summary);

  return (
    <View style={styles.item} testID={`recording-library-item-${source.id}`}>
      {/* Keep the row's real metadata together; export and deletion remain secondary actions. */}
      <View style={styles.summaryActionRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${recordedAt}, ${duration}, ${review}`}
          accessibilityHint={t('recording.library.openDetailsHint')}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onOpen}
          style={styles.summaryAction}
          testID={`recording-details-${source.id}`}
        >
          <View style={styles.summaryIcon}>
            <AppSymbol
              name="waveform"
              size={24}
              color={appColors.primaryText}
            />
          </View>
          <View style={styles.summaryText}>
            <Text style={styles.summaryTitle}>{title}</Text>
            <Text style={styles.copy}>{recordedAt}</Text>
          </View>
          <AppSymbol
            name="chevron.right"
            size={16}
            color={appColors.secondary}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('recording.library.playAudio')}
          accessibilityHint={t('recording.library.playAudioHint')}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onPlay}
          style={styles.listPlaybackButton}
          testID={`recording-playback-list-button-${source.id}`}
        >
          <AppSymbol name="play.fill" size={16} color={appColors.primaryText} />
        </Pressable>
      </View>
      <View style={styles.summaryMetadata}>
        <Text style={styles.copy}>{duration}</Text>
        <View style={reviewStyle(summary)}>
          <Text style={reviewTextStyle(summary)}>{review}</Text>
        </View>
      </View>
      <View style={styles.itemActions}>
        <View style={styles.actions}>
          <AppButton
            disabled={disabled}
            onPress={onDelete}
            testID={`recording-delete-${source.id}`}
            title={t('recording.library.delete')}
            variant="secondary"
          />
        </View>
      </View>
    </View>
  );
}
