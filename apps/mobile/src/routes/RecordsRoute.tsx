import { StyleSheet, View } from 'react-native';
import { appColors } from '../layout/appColors';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { useNavigationLeaveStateRegistration } from '../navigation';
import type { RecordingSourceRecord } from '../recording/recordingTypes';
import { RecordsRecentSources } from './RecordsRecentSources';
import { RecordsRouteEntries } from './RecordsRouteEntries';

export interface RecordsRouteProps {
  readonly recordings: readonly RecordingSourceRecord[];
  readonly recordingState: 'loading' | 'ready' | 'failed';
  readonly onRetryRecordings: () => void;
  readonly onOpenSymptoms: () => void;
  readonly onOpenSavedRecordings: () => void;
  readonly onOpenRecording: () => void;
  readonly onOpenHealthLibrary: () => void;
  readonly onOpenManualHistory: () => void;
}

/** Reflows existing destinations with Home's loaded local snapshot for recent-source previews. */
export function RecordsRoute({
  recordings,
  recordingState,
  onRetryRecordings,
  onOpenSymptoms,
  onOpenSavedRecordings,
  onOpenRecording,
  onOpenHealthLibrary,
  onOpenManualHistory,
}: RecordsRouteProps) {
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });

  return (
    <View style={styles.container}>
      <AdaptiveColumns
        primary={
          <RecordsRouteEntries
            onOpenSymptoms={onOpenSymptoms}
            onOpenSavedRecordings={onOpenSavedRecordings}
            onOpenRecording={onOpenRecording}
            onOpenHealthLibrary={onOpenHealthLibrary}
            onOpenManualHistory={onOpenManualHistory}
          />
        }
        secondary={
          <RecordsRecentSources
            recordings={recordings}
            recordingState={recordingState}
            onRetry={onRetryRecordings}
            onOpenSavedRecordings={onOpenSavedRecordings}
          />
        }
        testID="records-layout"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: appColors.background },
});
