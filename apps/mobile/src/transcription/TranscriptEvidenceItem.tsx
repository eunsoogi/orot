import { Pressable, TextInput, View } from 'react-native';
import type { TranscriptEvidenceSegment } from '@orot/domain';
import { AppButton } from '../layout/AppButton';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { transcriptEvidenceStyles as styles } from './TranscriptEvidencePanel.styles';

interface TranscriptEvidenceItemProps {
  segment: TranscriptEvidenceSegment;
  history: readonly TranscriptEvidenceSegment[];
  editing: boolean;
  busy: boolean;
  playing: boolean;
  draft: string;
  onDraftChange: (text: string) => void;
  onSave: () => Promise<void>;
  onCancel: () => void;
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
  editing,
  busy,
  playing,
  draft,
  onDraftChange,
  onSave,
  onCancel,
  onPlay,
  onEdit,
}: TranscriptEvidenceItemProps) {
  return (
    <View
      style={styles.segment}
      testID={`transcript-segment-${segment.segmentOrdinal}`}
    >
      <View style={styles.segmentHeader}>
        <View style={styles.reviewBadge}>
          <Text
            style={styles.reviewBadgeText}
            testID={`transcript-review-${segment.segmentOrdinal}`}
          >
            {reviewLabel(segment)}
          </Text>
        </View>
        <Text
          style={styles.metadata}
          testID={`transcript-origin-${segment.segmentOrdinal}`}
        >
          {originLabel(segment)}
        </Text>
      </View>
      {/* The single playback card keeps the reviewed segment and its exact source range together. */}
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
        style={styles.audioCard}
        testID={`transcript-play-${segment.segmentOrdinal}`}
      >
        <View style={styles.audioTopRow}>
          <View style={styles.playIcon}>
            <AppSymbol
              name={playing ? 'waveform' : 'play.fill'}
              size={20}
              color={appColors.onPrimary}
            />
          </View>
          <AppSymbol name="waveform" size={34} color={appColors.secondary} />
          <Text
            style={styles.metadata}
            testID={`transcript-range-${segment.segmentOrdinal}`}
          >
            {t('recording.transcript.range', {
              start: timeLabel(segment.audioRange.startMs),
              end: timeLabel(segment.audioRange.endMs),
            })}
          </Text>
        </View>
        <Text style={styles.audioCaption}>
          {playing
            ? t('recording.transcript.playing')
            : t('recording.transcript.play')}
        </Text>
      </Pressable>
      {editing ? (
        <View style={styles.editor}>
          <Text style={styles.editorTitle}>
            {t('recording.transcript.edit')}
          </Text>
          <TextInput
            accessibilityLabel={t('recording.transcript.input.label')}
            multiline
            onChangeText={onDraftChange}
            style={styles.input}
            testID={`transcript-input-${segment.segmentOrdinal}`}
            value={draft}
          />
        </View>
      ) : (
        <Text
          style={styles.text}
          testID={`transcript-text-${segment.segmentOrdinal}`}
        >
          {segment.text}
        </Text>
      )}
      <Text
        style={styles.verification}
        testID={`transcript-clinician-verification-${segment.segmentOrdinal}`}
      >
        {t('recording.transcript.verification.clinicianNotRecorded')}
      </Text>
      {editing ? (
        // Keep actions after the editor so the parent can reveal them above the keyboard.
        <View style={styles.actions}>
          <AppButton
            variant="secondary"
            disabled={busy}
            onPress={onCancel}
            testID={`transcript-cancel-${segment.segmentOrdinal}`}
            title={t('recording.transcript.cancel')}
          />
          <AppButton
            disabled={busy}
            onPress={onSave}
            testID={`transcript-save-${segment.segmentOrdinal}`}
            title={t('recording.transcript.save')}
          />
        </View>
      ) : null}
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
      {!editing ? (
        <View style={styles.actions}>
          <AppButton
            variant="secondary"
            disabled={busy}
            onPress={onEdit}
            testID={`transcript-edit-${segment.segmentOrdinal}`}
            title={t('recording.transcript.edit')}
          />
        </View>
      ) : null}
    </View>
  );
}
