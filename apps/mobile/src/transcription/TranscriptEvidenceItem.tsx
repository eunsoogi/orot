import { Pressable, View } from 'react-native';
import type { TranscriptEvidenceSegment } from '@orot/domain';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { transcriptEvidenceStyles as styles } from './TranscriptEvidencePanel.styles';

interface TranscriptEvidenceItemProps {
  segment: TranscriptEvidenceSegment;
  history: readonly TranscriptEvidenceSegment[];
  collapsed: boolean;
  busy: boolean;
  playing: boolean;
  onToggleCollapsed: () => void;
  onPlay: () => Promise<void>;
  onEdit: () => void;
}

function timeLabel(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const fraction = milliseconds % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(fraction).padStart(3, '0')}`;
}

function reviewLabel(segment: TranscriptEvidenceSegment): string {
  switch (segment.reviewState.status) {
    case 'unreviewed':
      return t('recording.transcript.review.unreviewed');
    case 'needs_review':
      return t('recording.transcript.review.needsReview');
    case 'reviewed':
      return t('recording.transcript.review.reviewed');
    default:
      throw new Error('Unknown transcript review state.');
  }
}

function originLabel(segment: TranscriptEvidenceSegment): string {
  switch (segment.provenance.origin) {
    case 'derived':
      return t('recording.transcript.origin.machine');
    case 'user_reported':
      return t('recording.transcript.origin.userCorrection');
    default:
      throw new Error('Unknown transcript provenance origin.');
  }
}

export default function TranscriptEvidenceItem({
  segment,
  history,
  collapsed,
  busy,
  playing,
  onToggleCollapsed,
  onPlay,
  onEdit,
}: TranscriptEvidenceItemProps) {
  return (
    <View
      style={styles.segment}
      testID={`transcript-segment-${segment.segmentOrdinal}`}
    >
      <View style={styles.segmentHeadingRow}>
        <Pressable
          accessibilityLabel={
            collapsed
              ? t('recording.transcript.expandSegment')
              : t('recording.transcript.collapseSegment')
          }
          accessibilityRole="button"
          accessibilityState={{ expanded: !collapsed }}
          onPress={onToggleCollapsed}
          style={styles.segmentHeader}
          testID={`transcript-segment-toggle-${segment.segmentOrdinal}`}
        >
          <View style={styles.segmentHeaderLabels}>
            <View style={styles.reviewBadge}>
              <Text
                style={styles.reviewBadgeText}
                testID={`transcript-review-${segment.segmentOrdinal}`}
              >
                {reviewLabel(segment)}
              </Text>
            </View>
            <Text
              style={styles.origin}
              testID={`transcript-origin-${segment.segmentOrdinal}`}
            >
              {originLabel(segment)}
            </Text>
          </View>
          <AppSymbol
            name={collapsed ? 'chevron.down' : 'chevron.up'}
            size={18}
            color={appColors.secondary}
          />
        </Pressable>
        <Pressable
          accessibilityLabel={t('recording.transcript.edit')}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={onEdit}
          style={styles.editButton}
          testID={`transcript-edit-${segment.segmentOrdinal}`}
        >
          <AppSymbol
            name="square.and.pencil"
            size={20}
            color={appColors.primaryText}
          />
        </Pressable>
      </View>
      {!collapsed ? (
        <View
          style={styles.segmentBody}
          testID={`transcript-segment-body-${segment.segmentOrdinal}`}
        >
          <View style={styles.audioCard}>
            <View style={styles.audioTopRow}>
              <Pressable
                accessibilityHint={t('recording.transcript.range', {
                  start: timeLabel(segment.audioRange.startMs),
                  end: timeLabel(segment.audioRange.endMs),
                })}
                accessibilityLabel={
                  playing
                    ? t('recording.transcript.playing')
                    : t('recording.transcript.play')
                }
                accessibilityRole="button"
                accessibilityState={{ disabled: playing }}
                disabled={playing}
                onPress={onPlay}
                style={styles.playButton}
                testID={`transcript-play-${segment.segmentOrdinal}`}
              >
                <AppSymbol
                  name={playing ? 'waveform' : 'play.fill'}
                  size={22}
                  color={appColors.onPrimary}
                />
              </Pressable>
              <View style={styles.audioRangeCopy}>
                <Text
                  style={styles.range}
                  testID={`transcript-range-${segment.segmentOrdinal}`}
                >
                  {t('recording.transcript.range', {
                    start: timeLabel(segment.audioRange.startMs),
                    end: timeLabel(segment.audioRange.endMs),
                  })}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: playing }}
                  disabled={playing}
                  onPress={onPlay}
                  style={styles.playRangeButton}
                  testID={`transcript-play-range-${segment.segmentOrdinal}`}
                >
                  <AppSymbol
                    name="play.fill"
                    size={15}
                    color={appColors.primaryText}
                  />
                  <Text style={styles.playRangeLabel}>
                    {playing
                      ? t('recording.transcript.playing')
                      : t('recording.transcript.play')}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
          <Text
            style={styles.textBubble}
            testID={`transcript-text-${segment.segmentOrdinal}`}
          >
            {segment.text}
          </Text>
          <Text
            style={styles.verification}
            testID={`transcript-clinician-verification-${segment.segmentOrdinal}`}
          >
            {t('recording.transcript.verification.clinicianNotRecorded')}
          </Text>
          {history.map(revision => (
            <Text
              key={revision.id}
              style={styles.history}
              testID={`transcript-history-${segment.segmentOrdinal}-${revision.revision}`}
            >
              {t('recording.transcript.history', {
                revision: revision.revision,
                text: revision.text,
              })}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
