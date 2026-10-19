import { useRecordingSelection } from '../recording/RecordingSelectionContext';
import type { NavigationRouteActions } from '../navigation/NavigationRouteAdapter';
import type { AppNavigationRoute } from './appNavigationRoute';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import RecordingLibraryPanel from '../recording/RecordingLibraryPanel';
import { recordingLibraryService } from '../recording/recordingLibraryService';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { NavigationRouteScrollView } from '../navigation/NavigationRouteScrollView';
import { appColors } from '../layout/appColors';

/** Keeps the saved library in its own route while preserving deletion's leave guard. */
export function SavedRecordingsRoute({
  actions,
}: {
  readonly actions: NavigationRouteActions<AppNavigationRoute>;
}) {
  const { select } = useRecordingSelection();
  const [busy, setBusy] = useState(false);
  useNavigationLeaveStateRegistration({
    canLeave: !busy,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: busy,
    revision: Number(busy),
    inputRevision: 0,
  });
  return (
    <NavigationRouteScrollView>
      <View style={styles.container}>
        <RecordingLibraryPanel
          service={recordingLibraryService}
          onBusyChange={setBusy}
          onOpenRecording={(summary, autoPlay) => {
            select({ summary, autoPlay });
            actions.push('recording-review');
          }}
        />
      </View>
    </NavigationRouteScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: appColors.background,
    padding: 20,
  },
});
