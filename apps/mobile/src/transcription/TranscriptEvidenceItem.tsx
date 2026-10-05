import { Button, Text, TextInput, View } from 'react-native';
import type { TranscriptEvidenceSegment } from '@orot/domain';
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
  const source = segment.provenance.source;
  return (
    <View
      style={styles.segment}
      testID={`transcript-segment-${segment.segmentOrdinal}`}
    >
      {/* Keep review state beside each segment so machine output stays visibly provisional. */}
      <Text
        style={styles.metadata}
        testID={`transcript-review-${segment.segmentOrdinal}`}
      >
        {reviewLabel(segment)}
      </Text>
      <Text
        style={styles.metadata}
        testID={`transcript-engine-${segment.segmentOrdinal}`}
      >
        {t('recording.transcript.engine', {
          engine: source?.sourceIdentifier ?? '',
        })}
      </Text>
      <Text
        style={styles.metadata}
        testID={`transcript-runtime-${segment.segmentOrdinal}`}
      >
        {t('recording.transcript.runtime', {
          version: source?.sourceVersion ?? '',
        })}
      </Text>
      <Text
        style={styles.metadata}
        testID={`transcript-range-${segment.segmentOrdinal}`}
      >
        {t('recording.transcript.range', {
          start: timeLabel(segment.audioRange.startMs),
          end: timeLabel(segment.audioRange.endMs),
        })}
      </Text>
      {editing ? (
        // Keep save and cancel above the editor so the keyboard cannot cover them on a short screen.
        <View style={styles.actions}>
          <Button
            disabled={busy}
            onPress={onSave}
            testID={`transcript-save-${segment.segmentOrdinal}`}
            title={t('recording.transcript.save')}
          />
          <Button
            disabled={busy}
            onPress={onCancel}
            testID={`transcript-cancel-${segment.segmentOrdinal}`}
            title={t('recording.transcript.cancel')}
          />
        </View>
      ) : null}
      {editing ? (
        <TextInput
          accessibilityLabel={t('recording.transcript.input.label')}
          multiline
          onChangeText={onDraftChange}
          style={styles.input}
          testID={`transcript-input-${segment.segmentOrdinal}`}
          value={draft}
        />
      ) : (
        <Text
          style={styles.text}
          testID={`transcript-text-${segment.segmentOrdinal}`}
        >
          {segment.text}
        </Text>
      )}
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
          <Button
            disabled={playing}
            onPress={onPlay}
            testID={`transcript-play-${segment.segmentOrdinal}`}
            title={
              playing
                ? t('recording.transcript.playing')
                : t('recording.transcript.play')
            }
          />
          <Button
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
