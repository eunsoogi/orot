import { Pressable, View } from 'react-native';
import { GlassIconButton } from '../layout/GlassIconButton';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { TrailingSwipeAction } from '../layout/TrailingSwipeAction';
import { swipeActionIconTileLaneWidth } from '../layout/SwipeActionIconTiles';
import { RecordingSwipeActionTiles } from './RecordingSwipeActionTiles';
import { formatRecordedAt } from './formatRecordedAt';
import { formatRecordingDuration } from './recordingTypes';
import { recordingLibraryStyles as styles } from './RecordingLibraryPanel.styles';
import type { RecordingLibrarySummary } from './recordingLibraryService';

interface RecordingLibrarySummaryRowProps {
  readonly summary: RecordingLibrarySummary;
  readonly disabled: boolean;
  readonly onOpen: () => void;
  readonly onPlay: () => void;
  readonly onShare?: () => void;
  readonly onDelete: () => void;
  readonly revealed: boolean;
  readonly onRevealedChange: (revealed: boolean) => void;
}

function reviewLabel(summary: RecordingLibrarySummary): string | undefined {
  switch (summary.transcriptReviewState) {
    case 'notTranscribed':
      return t('recording.library.transcriptNotStarted');
    case 'unreviewed':
      return undefined;
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
  // A saved machine transcript is neither a pending draft nor a reviewed result.
  if (summary.transcriptReviewState === 'needsReview') {
    return [styles.reviewBadge, styles.reviewNeeds];
  }
  return [styles.reviewBadge, styles.reviewUnavailable];
}

function reviewTextStyle(summary: RecordingLibrarySummary) {
  if (summary.transcriptReviewState === 'reviewed') {
    return styles.reviewCompleteText;
  }
  if (summary.transcriptReviewState === 'needsReview') {
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
  onShare,
  revealed,
  onRevealedChange,
}: RecordingLibrarySummaryRowProps) {
  const { source } = summary;
  const title = source.title ?? t('recording.library.untitled');
  const recordedAt = formatRecordedAt(source.recordedAt);
  const duration =
    summary.durationMs === null
      ? t('recording.library.durationUnavailable')
      : formatRecordingDuration(summary.durationMs);
  const review = reviewLabel(summary);
  const deleteLabel = t('recording.library.delete');

  return (
    <TrailingSwipeAction
      revealDuringDrag={Boolean(onShare)}
      revealWidth={onShare ? swipeActionIconTileLaneWidth : undefined}
      action={
        onShare ? (
          <RecordingSwipeActionTiles
            sourceId={source.id}
            onShare={onShare}
            onDelete={onDelete}
          />
        ) : (
          <View
            style={styles.swipeActionSlot}
            testID={`recording-delete-slot-${source.id}`}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={deleteLabel}
              disabled={disabled || !revealed}
              onPress={onDelete}
              style={styles.swipeDelete}
              testID={`recording-delete-${source.id}`}
            >
              <Text style={styles.swipeDeleteText}>
                {t('recording.library.confirmDelete')}
              </Text>
            </Pressable>
          </View>
        )
      }
      disabled={disabled}
      revealed={revealed}
      onRevealedChange={onRevealedChange}
      testID={`recording-library-item-${source.id}`}
    >
      <View
        style={[
          styles.item,
          styles.summaryActionRow,
          onShare && styles.savedItem,
        ]}
        testID={`recording-row-content-${source.id}`}
      >
        <GlassIconButton
          accessibilityRole="button"
          accessibilityLabel={t('recording.library.playAudio')}
          accessibilityHint={t('recording.library.playAudioHint')}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onPlay}
          style={styles.listPlaybackButton}
          testID={`recording-playback-list-button-${source.id}`}
          symbolName="play.fill"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={[title, recordedAt, duration, review]
            .filter(Boolean)
            .join(', ')}
          accessibilityHint={t('recording.library.openDetailsHint')}
          accessibilityState={{ disabled }}
          accessibilityActions={
            disabled
              ? undefined
              : [
                  ...(onShare
                    ? [{ name: 'share', label: t('recording.library.share') }]
                    : []),
                  { name: 'delete', label: deleteLabel },
                ]
          }
          onAccessibilityAction={event => {
            if (
              !disabled &&
              (event.nativeEvent.actionName === 'delete' ||
                (onShare && event.nativeEvent.actionName === 'share'))
            )
              onRevealedChange(true);
          }}
          disabled={disabled}
          onPress={onOpen}
          style={styles.summaryAction}
          testID={`recording-details-${source.id}`}
        >
          <View style={styles.summaryText}>
            <Text style={styles.summaryTitle}>{title}</Text>
            <Text
              style={styles.copy}
              testID={`recording-row-date-${source.id}`}
            >
              {recordedAt}
            </Text>
            <Text
              style={styles.copy}
              testID={`recording-row-duration-${source.id}`}
            >
              {duration}
            </Text>
            {review ? (
              <View style={reviewStyle(summary)}>
                <Text style={reviewTextStyle(summary)}>{review}</Text>
              </View>
            ) : null}
          </View>
          <View
            testID={`recording-row-chevron-${source.id}`}
            accessible={false}
          >
            <AppSymbol
              name="chevron.right"
              size={16}
              color={appColors.secondary}
            />
          </View>
        </Pressable>
      </View>
    </TrailingSwipeAction>
  );
}
