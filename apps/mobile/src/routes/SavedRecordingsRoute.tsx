import { useRecordingSelection } from '../recording/RecordingSelectionContext';
import type { NavigationRouteActions } from '../navigation/NavigationRouteAdapter';
import type { AppNavigationRoute } from './appNavigationRoute';
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import RecordingLibraryPanel from '../recording/RecordingLibraryPanel';
import { recordingLibraryService } from '../recording/recordingLibraryService';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { NavigationRouteScrollView } from '../navigation/NavigationRouteScrollView';
import { appColors } from '../layout/appColors';
import { useAutomaticRecordingTranscription } from '../recording/useAutomaticRecordingTranscription';
import { transcriptEvidenceService } from '../transcription/transcriptEvidenceService';
import type { RecordingLibraryService } from '../recording/recordingLibraryService';

/** Keeps the saved library in its own route while preserving deletion's leave guard. */
export function SavedRecordingsRoute({
  actions,
  libraryService = recordingLibraryService,
}: {
  readonly actions: NavigationRouteActions<AppNavigationRoute>;
  readonly libraryService?: RecordingLibraryService;
}) {
  const { select, selection } = useRecordingSelection();
  const { width } = useWindowDimensions();
  const [busy, setBusy] = useState(false);
  const transcription = useAutomaticRecordingTranscription(
    transcriptEvidenceService,
  );
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
      <View
        style={[
          styles.container,
          // Keep a full 320-point row in the narrowest supported viewport.
          width <= 360 ? styles.narrowViewport : null,
        ]}
      >
        <RecordingLibraryPanel
          onNewRecording={() => actions.push('recording')}
          automaticTranscription={transcription.state}
          onSourceDeleted={transcription.cancel}
          selectedSummarySourceId={selection?.summary.source.id ?? null}
          service={libraryService}
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
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  narrowViewport: { paddingHorizontal: 0 },
});
