import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { TranscriptEvidenceSegment } from '@orot/domain';
import { AppText as Text } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { t } from '../i18n';
import TranscriptEvidenceItem from './TranscriptEvidenceItem';
import TranscriptReviewHeader from './TranscriptReviewHeader';
import TranscriptCorrectionEditor from './TranscriptCorrectionEditor';
import {
  latestRevisions,
  errorLabel,
  transcriptionCreationError,
  type TranscriptError,
} from './transcriptReviewPresentation';
import TranscriptReviewSummary from './TranscriptReviewSummary';
import {
  type TranscriptEvidenceService,
  type TranscriptRecordingView,
  transcriptEvidenceService,
} from './transcriptEvidenceService';
import { transcriptEvidenceStyles as styles } from './TranscriptEvidencePanel.styles';
interface TranscriptEvidencePanelProps {
  recordingSourceId?: string;
  service?: TranscriptEvidenceService;
  playSegment?: TranscriptEvidenceService['play'];
  deletionBusy?: boolean;
  savedDetail?: boolean;
  automaticTranscriptionStatus?: 'running' | 'failed' | 'complete';
  onRequestDelete?: (sourceId: string) => void;
  onInteractionChange?: (state: { busy: boolean; dirty: boolean }) => void;
}
export default function TranscriptEvidencePanel({
  recordingSourceId,
  service = transcriptEvidenceService,
  playSegment = service.play,
  deletionBusy = false,
  savedDetail = false,
  automaticTranscriptionStatus,
  onRequestDelete,
  onInteractionChange,
}: TranscriptEvidencePanelProps) {
  const [view, setView] = useState<TranscriptRecordingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranscriptError | null>(null);
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [playingSegmentId, setPlayingSegmentId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState(() => new Set<string>());
  const isCollapsed = (id: string) =>
    !savedDetail && editingSegmentId !== id && collapsedIds.has(id);
  const latest = latestRevisions(view?.segments ?? []);
  const matchesEdit = (segment: TranscriptEvidenceSegment) =>
    segment.id === editingSegmentId;
  const editingSegment = latest.find(matchesEdit);
  const originalText = view?.segments.find(matchesEdit)?.text;
  const dirty = editingSegmentId !== null && draft !== originalText;
  useEffect(() => {
    onInteractionChange?.({ busy, dirty });
  }, [busy, dirty, onInteractionChange]);
  async function reload(): Promise<void> {
    const next = await service.load(recordingSourceId);
    setView(next);
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    setView(null);
    setError(null);
    service
      .load(recordingSourceId)
      .then(
        next => {
          if (active) setView(next);
        },
        () => {
          if (active) setError('load');
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [recordingSourceId, service, automaticTranscriptionStatus]);
  async function createTranscript(): Promise<void> {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      await service.transcribe(view.source.id);
      await reload();
    } catch (failure) {
      setError(transcriptionCreationError(failure));
    } finally {
      setBusy(false);
    }
  }
  async function saveCorrection(): Promise<void> {
    if (!editingSegmentId) return;
    setBusy(true);
    setError(null);
    try {
      await service.correct(editingSegmentId, draft);
      setEditingSegmentId(null);
      setDraft('');
      await reload();
    } catch {
      setError('correct');
    } finally {
      setBusy(false);
    }
  }
  async function play(segment: TranscriptEvidenceSegment): Promise<void> {
    setPlayingSegmentId(segment.id);
    setError(null);
    try {
      await playSegment(segment);
    } catch {
      setError('play');
    } finally {
      setPlayingSegmentId(null);
    }
  }
  if (!loading && !view && !error) return null;
  return (
    <View style={styles.container} testID="transcript-panel">
      <TranscriptReviewHeader
        savedDetail={savedDetail}
        expanded={expanded}
        disabled={dirty || busy}
        toggle={() => setExpanded(value => !value)}
      />
      {view && onRequestDelete ? (
        <AppButton
          disabled={busy || deletionBusy}
          onPress={() => onRequestDelete(view.source.id)}
          testID="recording-transcript-delete"
          title={t('recording.library.delete')}
          variant="secondary"
        />
      ) : null}
      {loading ? (
        <Text style={styles.copy}>{t('recording.transcript.loading')}</Text>
      ) : null}
      {automaticTranscriptionStatus === 'running' ? (
        <Text accessibilityLiveRegion="polite" style={styles.copy}>
          {t('recording.transcript.autoProgress')}
        </Text>
      ) : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          style={styles.error}
          testID="transcript-error"
        >
          {errorLabel(error)}
        </Text>
      ) : null}
      {!view && !loading ? (
        <Text style={styles.copy}>{t('recording.transcript.noRecording')}</Text>
      ) : null}
      {view &&
      latest.length === 0 &&
      automaticTranscriptionStatus !== 'running' ? (
        <>
          <Text style={styles.copy}>{t('recording.transcript.empty')}</Text>
          <AppButton
            disabled={busy}
            onPress={createTranscript}
            testID="transcript-create"
            title={
              busy
                ? t('recording.transcript.creating')
                : t('recording.transcript.create')
            }
          />
        </>
      ) : null}
      {view && latest.length > 0 && (!savedDetail || expanded) ? (
        <View style={styles.reviewCard}>
          {!savedDetail ? (
            <TranscriptReviewSummary source={view.source} segments={latest} />
          ) : null}
          {view.staleArtifacts.length > 0 ? (
            <Text style={styles.error} testID="transcript-stale-artifacts">
              {t('recording.transcript.staleArtifacts', {
                count: view.staleArtifacts.length,
              })}
            </Text>
          ) : null}
          {/* The recording screen owns scrolling so nested transcript lists do not trap review actions on compact screens. */}
          <View
            style={[styles.segments, savedDetail && styles.savedSegments]}
            testID="transcript-segment-list"
          >
            {latest.map(segment => {
              const history = view.segments.filter(
                revision =>
                  revision.transcriptId === segment.transcriptId &&
                  revision.revision < segment.revision,
              );
              return (
                <TranscriptEvidenceItem
                  key={segment.transcriptId}
                  segment={segment}
                  history={history}
                  collapsed={isCollapsed(segment.id)}
                  savedDetail={savedDetail}
                  busy={busy}
                  playing={playingSegmentId === segment.id}
                  onToggleCollapsed={
                    savedDetail
                      ? undefined
                      : () => {
                          setCollapsedIds(previous => {
                            const next = new Set(previous);
                            if (next.has(segment.id)) next.delete(segment.id);
                            else next.add(segment.id);
                            return next;
                          });
                        }
                  }
                  onPlay={() => play(segment)}
                  onEdit={() => {
                    setDraft(segment.text);
                    setEditingSegmentId(segment.id);
                  }}
                />
              );
            })}
          </View>
          {editingSegment ? (
            <TranscriptCorrectionEditor
              ordinal={editingSegment.segmentOrdinal}
              busy={busy}
              draft={draft}
              onChange={setDraft}
              onSave={saveCorrection}
              onCancel={() => setEditingSegmentId(null)}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
