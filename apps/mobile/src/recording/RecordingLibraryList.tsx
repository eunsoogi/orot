import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { GlassIconButton } from '../layout/GlassIconButton';
import { AppText as Text } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { AppProgress } from '../layout/AppProgress';
import { t } from '../i18n';
import RecordingLibrarySummaryRow from './RecordingLibrarySummaryRow';
import type { RecordingLibrarySummary } from './recordingLibraryService';
import type { RecordingSourceRecord } from './recordingTypes';
import { recordingLibraryStyles as styles } from './RecordingLibraryPanel.styles';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';

/** Keeps list feedback and saved-source actions separate from the selected review content. */
export default function RecordingLibraryList({
  recordings,
  loading,
  loadError,
  disabled,
  onOpen,
  onDelete,
  onShare,
  onNewRecording,
  onRetry,
}: {
  readonly recordings: readonly RecordingLibrarySummary[];
  readonly loading: boolean;
  readonly loadError: boolean;
  readonly disabled: boolean;
  readonly onOpen: (id: string, autoPlay?: boolean) => void;
  readonly onShare?: (id: string) => void;
  readonly onDelete: (source: RecordingSourceRecord) => void;
  readonly onNewRecording?: () => void;
  readonly onRetry?: () => void;
}) {
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const currentShare = useRef<((id: string) => void) | null>(null);
  useLayoutEffect(() => {
    // A callback from a retired row cannot export a different or no longer revealed source.
    currentShare.current = id => {
      if (
        disabled ||
        revealedId !== id ||
        !recordings.some(item => item.source.id === id)
      )
        return;
      setRevealedId(null);
      onShare?.(id);
    };
    return () => {
      currentShare.current = null;
    };
  }, [disabled, onShare, recordings, revealedId]);
  useEffect(() => {
    if (
      revealedId !== null &&
      (disabled || !recordings.some(item => item.source.id === revealedId))
    ) {
      setRevealedId(null);
    }
  }, [disabled, recordings, revealedId]);
  const changeReveal = (sourceId: string, revealed: boolean) => {
    setRevealedId(previous => {
      if (revealed) return sourceId;
      return previous === sourceId ? null : previous;
    });
  };
  const runRowAction = (action: () => void) => {
    if (disabled) return;
    setRevealedId(null);
    action();
  };
  const label = t('recording.start');
  const hasDock = useNavigationRouteActions(
    onNewRecording
      ? [
          {
            id: 'new-recording',
            label,
            accessibilityLabel: label,
            testID: 'saved-recordings-new',
            systemImageName: 'mic.fill',
            disabled,
            onPress: onNewRecording,
          },
        ]
      : [],
  );
  return (
    <View style={styles.libraryLane} testID="recording-library-lane">
      <View style={styles.libraryHeading}>
        <Text
          accessibilityRole="header"
          style={[styles.title, onNewRecording && styles.pageTitle]}
        >
          {t('recording.library.title')}
        </Text>
        {onNewRecording && !hasDock ? (
          <GlassIconButton
            accessibilityRole="button"
            accessibilityLabel={t('recording.start')}
            disabled={disabled}
            onPress={onNewRecording}
            style={styles.listPlaybackButton}
            testID="saved-recordings-new"
            symbolName="mic.fill"
          />
        ) : null}
      </View>
      {onNewRecording ? (
        <Text style={styles.copy}>{t('recording.library.description')}</Text>
      ) : null}
      {loading ? (
        <View>
          <AppProgress accessibilityElementsHidden />
          <Text accessibilityLiveRegion="polite">
            {t('recording.library.loading')}
          </Text>
        </View>
      ) : null}
      {!loading && loadError ? (
        <View>
          <Text accessibilityRole="alert" style={styles.error}>
            {t('recording.library.loadError')}
          </Text>
          {onRetry ? (
            <AppButton
              disabled={disabled}
              onPress={onRetry}
              testID="recording-library-retry"
              title={t('appointments.retry')}
              variant="secondary"
            />
          ) : null}
        </View>
      ) : null}
      {!loading && !loadError && recordings.length === 0 ? (
        <Text style={styles.copy} testID="recording-library-empty">
          {t('recording.library.empty')}
        </Text>
      ) : null}
      {recordings.length > 0 ? (
        <View
          style={onShare ? styles.savedList : styles.list}
          testID="recording-library-list"
        >
          {recordings.map(summary => (
            <RecordingLibrarySummaryRow
              key={summary.source.id}
              summary={summary}
              disabled={disabled}
              onOpen={() => runRowAction(() => onOpen(summary.source.id))}
              onPlay={() => runRowAction(() => onOpen(summary.source.id, true))}
              revealed={revealedId === summary.source.id}
              onRevealedChange={revealed =>
                changeReveal(summary.source.id, revealed)
              }
              onShare={
                onShare
                  ? () => currentShare.current?.(summary.source.id)
                  : undefined
              }
              onDelete={() => runRowAction(() => onDelete(summary.source))}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
