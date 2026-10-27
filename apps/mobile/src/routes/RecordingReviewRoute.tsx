import { useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
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
import { transcriptEvidenceService } from '../transcription/transcriptEvidenceService';
import { useAutomaticRecordingTranscription } from '../recording/useAutomaticRecordingTranscription';
import { EncounterReviewPanel } from '../encounterReview/EncounterReviewPanel';
import type { EncounterReviewService } from '../encounterReview/controller';

/** Saved-source details retain review, playback and export as sections of one recording flow. */
export function RecordingReviewRoute({
  reviewService,
}: { readonly reviewService?: EncounterReviewService } = {}) {
  const focused = useIsFocused();
  const { selection } = useRecordingSelection();
  const transcription = useAutomaticRecordingTranscription(
    transcriptEvidenceService,
  );
  const [interaction, setInteraction] = useState({ busy: false, dirty: false });
  const [exportBusy, setExportBusy] = useState(false);
  const [review, setReview] = useState({ busy: false, dirty: false });
  const [autoPlayConsumed, setAutoPlayConsumed] = useState(false);
  const busy = interaction.busy || exportBusy || review.busy;
  const dirty = interaction.dirty || review.dirty;
  useNavigationLeaveStateRegistration({
    canLeave: !busy,
    hasUnsavedChanges: dirty,
    isRecording: false,
    hasOngoingOperation: busy,
    revision: Number(busy),
    inputRevision: Number(dirty),
  });
  const source = selection?.summary.source;
  return (
    <NavigationRouteScrollView>
      <View style={styles.page}>
        {source && selection ? (
          <>
            <RecordingPlaybackControls
              active={focused}
              recordingId={source.id}
              durationMs={selection.summary.durationMs}
              playbackService={recordingService}
              autoPlay={selection.autoPlay && !autoPlayConsumed}
              onAutoPlayConsumed={() => setAutoPlayConsumed(true)}
            />
            <TranscriptEvidencePanel
              recordingSourceId={source.id}
              deletionBusy={exportBusy || review.busy}
              onInteractionChange={setInteraction}
              automaticTranscriptionStatus={
                transcription.state?.sourceId === source.id
                  ? transcription.state.status
                  : undefined
              }
            />
            <EncounterReviewPanel
              key={source.id}
              sourceId={source.id}
              disabled={interaction.busy || interaction.dirty || exportBusy}
              onInteractionChange={setReview}
              service={reviewService}
            />
            <RecordingExportPanel
              recordingSourceId={source.id}
              onBusyChange={setExportBusy}
              actionsDisabled={busy || dirty}
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
