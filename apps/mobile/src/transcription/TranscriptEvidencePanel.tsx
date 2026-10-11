import { useEffect, useState } from 'react';
import { Button, Text, View } from 'react-native';
import type { TranscriptEvidenceSegment } from '@orot/domain';
import { t } from '../i18n';
import TranscriptEvidenceItem from './TranscriptEvidenceItem';
import type {
  TranscriptEvidenceService,
  TranscriptRecordingView,
} from './transcriptEvidenceService';
import { transcriptEvidenceService } from './transcriptEvidenceService';
import { transcriptEvidenceStyles as styles } from './TranscriptEvidencePanel.styles';

interface TranscriptEvidencePanelProps {
  recordingSourceId?: string;
  service?: TranscriptEvidenceService;
  deletionBusy?: boolean;
  automaticTranscriptionStatus?: 'running' | 'failed' | 'complete';
  onRequestDelete?: (sourceId: string) => void;
}

function latestRevisions(
  segments: readonly TranscriptEvidenceSegment[],
): TranscriptEvidenceSegment[] {
  // Show each current segment once while keeping earlier revisions available as evidence history.
  const latest = new Map<string, TranscriptEvidenceSegment>();
  for (const segment of segments) {
    const current = latest.get(segment.transcriptId);
    if (!current || segment.revision > current.revision)
      latest.set(segment.transcriptId, segment);
  }
  return [...latest.values()].sort(
    (left, right) => left.segmentOrdinal - right.segmentOrdinal,
  );
}

type TranscriptError = 'load' | 'create' | 'correct' | 'play';

function errorLabel(error: TranscriptError): string {
  switch (error) {
    case 'load':
      return t('recording.transcript.error.load');
    case 'create':
      return t('recording.transcript.error.create');
    case 'correct':
      return t('recording.transcript.error.correct');
    case 'play':
      return t('recording.transcript.error.play');
  }
}

export default function TranscriptEvidencePanel({
  recordingSourceId,
  service = transcriptEvidenceService,
  deletionBusy = false,
  automaticTranscriptionStatus,
  onRequestDelete,
}: TranscriptEvidencePanelProps) {
  const [view, setView] = useState<TranscriptRecordingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranscriptError | null>(null);
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [playingSegmentId, setPlayingSegmentId] = useState<string | null>(null);

  async function reload(): Promise<void> {
    const next = await service.load(recordingSourceId);
    setView(next);
  }

  // The parent remounts this preview when its source list changes so deleted text cannot linger.
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
  }, [recordingSourceId, service]);

  async function createTranscript(): Promise<void> {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      await service.transcribe(view.source.id);
      await reload();
    } catch {
      setError('create');
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
      await service.play(segment);
    } catch {
      setError('play');
    } finally {
      setPlayingSegmentId(null);
    }
  }

  if (!loading && !view && !error) return null;
  const latest = latestRevisions(view?.segments ?? []);
  return (
    <View style={styles.container} testID="transcript-panel">
      <Text accessibilityRole="header" style={styles.title}>
        {t('recording.transcript.title')}
      </Text>
      <Text style={styles.copy}>{t('recording.transcript.localOnly')}</Text>
      <Text style={styles.copy}>{t('recording.transcript.description')}</Text>
      {view && onRequestDelete ? (
        <Button
          disabled={busy || deletionBusy}
          onPress={() => onRequestDelete(view.source.id)}
          testID="recording-transcript-delete"
          title={t('recording.library.delete')}
        />
      ) : null}
      {loading ? (
        <Text style={styles.copy}>{t('recording.transcript.loading')}</Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
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
          <Button
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
      {view && latest.length > 0 ? (
        <>
          <Text style={styles.copy}>
            {t('recording.transcript.correctionNotice')}
          </Text>
          {view.staleArtifacts.length > 0 ? (
            <Text style={styles.error} testID="transcript-stale-artifacts">
              {t('recording.transcript.staleArtifacts', {
                count: view.staleArtifacts.length,
              })}
            </Text>
          ) : null}
          {/* The recording screen owns scrolling so nested transcript lists do not trap review actions on compact screens. */}
          <View style={styles.segments} testID="transcript-segment-list">
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
                  editing={editingSegmentId === segment.id}
                  busy={busy}
                  playing={playingSegmentId === segment.id}
                  draft={draft}
                  onDraftChange={setDraft}
                  onSave={saveCorrection}
                  onCancel={() => setEditingSegmentId(null)}
                  onPlay={() => play(segment)}
                  onEdit={() => {
                    setDraft(segment.text);
                    setEditingSegmentId(segment.id);
                  }}
                />
              );
            })}
          </View>
        </>
      ) : null}
    </View>
  );
}
