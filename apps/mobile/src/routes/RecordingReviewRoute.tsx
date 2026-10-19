import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { NavigationRouteScrollView } from '../navigation/NavigationRouteScrollView';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { useRecordingSelection } from '../recording/RecordingSelectionContext';
import RecordingPlaybackControls from '../recording/RecordingPlaybackControls';
import RecordingExportPanel from '../recording/RecordingExportPanel';
import { recordingService } from '../recording/recordingService';
import TranscriptEvidencePanel from '../transcription/TranscriptEvidencePanel';

/** Saved-source details retain review, playback and export as sections of one recording flow. */
export function RecordingReviewRoute() {
  const { selection } = useRecordingSelection();
  const [interaction, setInteraction] = useState({ busy: false, dirty: false });
  const [exportBusy, setExportBusy] = useState(false);
  const [autoPlayConsumed, setAutoPlayConsumed] = useState(false);
  const busy = interaction.busy || exportBusy;
  useNavigationLeaveStateRegistration({
    canLeave: !busy,
    hasUnsavedChanges: interaction.dirty,
    isRecording: false,
    hasOngoingOperation: busy,
    revision: Number(busy),
    inputRevision: Number(interaction.dirty),
  });
  const source = selection?.summary.source;
  return (
    <NavigationRouteScrollView>
      <View style={styles.page}>
        {source && selection ? (
          <>
            <TranscriptEvidencePanel
              recordingSourceId={source.id}
              deletionBusy={exportBusy}
              onInteractionChange={setInteraction}
            />
            <RecordingPlaybackControls
              recordingId={source.id}
              durationMs={selection.summary.durationMs}
              playbackService={recordingService}
              autoPlay={selection.autoPlay && !autoPlayConsumed}
              onAutoPlayConsumed={() => setAutoPlayConsumed(true)}
            />
            <RecordingExportPanel
              recordingSourceId={source.id}
              onBusyChange={setExportBusy}
              actionsDisabled={interaction.busy || interaction.dirty}
            />
          </>
        ) : (
          <AppText>{t('recording.transcript.noRecording')}</AppText>
        )}
      </View>
    </NavigationRouteScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flexGrow: 1,
    padding: 20,
    gap: 20,
    backgroundColor: appColors.background,
  },
});
