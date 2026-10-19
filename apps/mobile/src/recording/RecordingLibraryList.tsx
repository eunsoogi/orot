import { View } from 'react-native';
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
}: {
  readonly recordings: readonly RecordingLibrarySummary[];
  readonly loading: boolean;
  readonly loadError: boolean;
  readonly disabled: boolean;
  readonly onOpen: (id: string, autoPlay?: boolean) => void;
  readonly onDelete: (source: RecordingSourceRecord) => void;
}) {
  return (
    <>
      <Text accessibilityRole="header" style={styles.title}>
        {t('recording.library.title')}
      </Text>
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
