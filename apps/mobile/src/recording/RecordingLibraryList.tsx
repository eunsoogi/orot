import { Pressable, View } from 'react-native';
import { ComposerGlassBackground } from '../ragConversation/ComposerGlassBackground';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import RecordingLibrarySummaryRow from './RecordingLibrarySummaryRow';
import type { RecordingLibrarySummary } from './recordingLibraryService';
import type { RecordingSourceRecord } from './recordingTypes';
import { recordingLibraryStyles as styles } from './RecordingLibraryPanel.styles';

/** Keeps list feedback and saved-source actions separate from the selected review content. */
export default function RecordingLibraryList({
  recordings,
  loading,
  loadError,
  disabled,
  onOpen,
  onDelete,
  onNewRecording,
}: {
  readonly recordings: readonly RecordingLibrarySummary[];
  readonly loading: boolean;
  readonly loadError: boolean;
  readonly disabled: boolean;
  readonly onOpen: (id: string, autoPlay?: boolean) => void;
  readonly onDelete: (source: RecordingSourceRecord) => void;
  readonly onNewRecording?: () => void;
}) {
  return (
    <>
      <View style={styles.libraryHeading}>
        <Text
          accessibilityRole="header"
          style={[styles.title, onNewRecording && styles.pageTitle]}
        >
          {t('recording.library.title')}
        </Text>
        {onNewRecording ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('recording.start')}
            disabled={disabled}
            onPress={onNewRecording}
            style={styles.listPlaybackButton}
            testID="saved-recordings-new"
          >
            <ComposerGlassBackground />
            <AppSymbol name="mic.fill" color={appColors.primaryText} />
          </Pressable>
        ) : null}
      </View>
      {onNewRecording ? (
        <Text style={styles.copy}>{t('recording.library.description')}</Text>
      ) : null}
      {loading ? <Text>{t('recording.library.loading')}</Text> : null}
      {loadError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {t('recording.library.loadError')}
        </Text>
      ) : null}
      {!loading && recordings.length === 0 ? (
        <Text style={styles.copy} testID="recording-library-empty">
          {t('recording.library.empty')}
        </Text>
      ) : null}
      {recordings.length > 0 ? (
        <View style={styles.list} testID="recording-library-list">
          {recordings.map(summary => (
            <RecordingLibrarySummaryRow
              key={summary.source.id}
              summary={summary}
              disabled={disabled}
              onOpen={() => onOpen(summary.source.id)}
              onPlay={() => onOpen(summary.source.id, true)}
              onDelete={() => onDelete(summary.source)}
            />
          ))}
        </View>
      ) : null}
    </>
  );
}
