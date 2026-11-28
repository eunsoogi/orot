import { useRecordingSelection } from '../recording/RecordingSelectionContext';
import type { NavigationRouteActions } from '../navigation/NavigationRouteAdapter';
import type { AppNavigationRoute } from './appNavigationRoute';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import RecordingLibraryPanel from '../recording/RecordingLibraryPanel';
import { recordingLibraryService } from '../recording/recordingLibraryService';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { NavigationRouteScrollView } from '../navigation/NavigationRouteScrollView';
import { appColors } from '../layout/appColors';
import { AppText } from '../layout/AppText';
import { useSavedRecordingShare } from '../recording/useSavedRecordingShare';
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
  const { select } = useRecordingSelection();
  const { width } = useWindowDimensions();
  const [busy, setBusy] = useState(false);
  const [reviewReturnRevision, setReviewReturnRevision] = useState(0);
  const pendingReviewReturn = useRef(false);
  const ownership = actions.ownership;
  const share = useSavedRecordingShare(ownership);
  const operating = busy || share.busy;
  useEffect(
    () =>
      ownership?.subscribe(() => {
        if (!pendingReviewReturn.current || !ownership.isCurrent()) return;
        // The list stays mounted behind review. Only reread the durable title
        // after this exact route returns, not on every geometry or selection change.
        pendingReviewReturn.current = false;
        setReviewReturnRevision(value => value + 1);
      }),
    [ownership],
  );
  const transcription = useAutomaticRecordingTranscription(
    transcriptEvidenceService,
  );
  useNavigationLeaveStateRegistration({
    canLeave: !operating,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: operating,
    revision: Number(operating),
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
          service={libraryService}
          refreshKey={String(reviewReturnRevision)}
          onBusyChange={setBusy}
          actionsDisabled={share.busy}
          onShareRecording={share.share}
          onOpenRecording={(summary, autoPlay) => {
            select({ summary, autoPlay });
            if (actions.push('recording-review'))
              pendingReviewReturn.current = true;
          }}
        />
        {share.error ? (
          <AppText accessibilityRole="alert" style={styles.shareError}>
            {share.error}
          </AppText>
        ) : null}
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
  shareError: { color: appColors.danger, marginTop: 12 },
  narrowViewport: { paddingHorizontal: 0 },
});
