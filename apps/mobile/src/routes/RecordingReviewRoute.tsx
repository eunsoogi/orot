import {
  RecentRecordingMetadataRefresh,
  type RecentRecordingMetadata,
} from './RecentRecordingMetadataRefresh';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import { useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../layout/AppText';
import { VerticalPageSections as AdaptiveColumns } from '../layout/VerticalPageSections';
import { materialLibraryStyles } from '../layout/MaterialLibraryRows';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { NavigationRouteScrollView } from '../navigation/NavigationRouteScrollView';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { useRecordingSelection } from '../recording/RecordingSelectionContext';
import RecordingPlaybackControls from '../recording/RecordingPlaybackControls';
import RecordingExportPanel from '../recording/RecordingExportPanel';
import { useRouteRecordingPlayback } from '../recording/useRouteRecordingPlayback';
import { SavedRecordingDeleteAction } from '../recording/SavedRecordingDeleteAction';
import { recordingService } from '../recording/recordingService';
import TranscriptEvidencePanel from '../transcription/TranscriptEvidencePanel';
import { transcriptEvidenceService } from '../transcription/transcriptEvidenceService';
import { useAutomaticRecordingTranscription } from '../recording/useAutomaticRecordingTranscription';
import { EncounterReviewPanel } from '../encounterReview/EncounterReviewPanel';
import type { EncounterReviewService } from '../encounterReview/controller';

/** Saved-source details retain review, playback and export as sections of one recording flow. */
export function RecordingReviewRoute({
  reviewService,
  routeKey,
  routeOwner,
  onBack,
}: {
  readonly reviewService?: EncounterReviewService;
  readonly routeKey?: string;
  readonly routeOwner?: NavigationRouteOwnership;
  readonly onBack?: () => void | Promise<boolean>;
} = {}) {
  const focused = useIsFocused();
  const { selection } = useRecordingSelection();
  const transcription = useAutomaticRecordingTranscription(
    transcriptEvidenceService,
  );
  const [interaction, setInteraction] = useState({ busy: false, dirty: false });
  const [exportBusy, setExportBusy] = useState(false);
  const [review, setReview] = useState({ busy: false, dirty: false });
  const [autoPlayConsumed, setAutoPlayConsumed] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [generatedTitle, setGeneratedTitle] = useState<{
    id: string;
    value: string;
  }>();
  const selectedSource =
    !selection?.recentRouteKey || selection.recentRouteKey === routeKey
      ? selection?.summary.source
      : undefined;
  const recent = Boolean(
    routeKey &&
    routeOwner &&
    selection?.recentRouteKey === routeKey &&
    selectedSource,
  );
  const [presentation, setPresentation] = useState<{
    owner: typeof selection;
    value: RecentRecordingMetadata;
    durationMs: number | null;
  }>();
  const metadata =
    recent && presentation?.owner === selection
      ? presentation.value
      : undefined;
  const source =
    metadata?.status === 'missing' || metadata?.status === 'protected'
      ? undefined
      : selectedSource;
  const busy = interaction.busy || exportBusy || review.busy || deleteBusy;
  const dirty = interaction.dirty || review.dirty;
  useNavigationLeaveStateRegistration({
    canLeave: !busy,
    hasUnsavedChanges: dirty,
    isRecording: false,
    hasOngoingOperation: busy,
    revision: Number(busy),
    inputRevision: Number(dirty),
  });
  const playback = useRouteRecordingPlayback(
    recordingService,
    source?.id,
    focused,
  );
  return (
    <NavigationRouteScrollView pullToRefresh={recent}>
      {recent && selectedSource && routeOwner ? (
        <RecentRecordingMetadataRefresh
          key={routeKey}
          id={selectedSource.id}
          active={focused}
          enabled={!busy && !dirty}
          owner={routeOwner}
          publish={value =>
            setPresentation(previous => {
              // A failed retry is not permission to restore panels hidden by a lock or deletion.
              if (
                previous?.owner === selection &&
                value.status === 'unavailable' &&
                (previous?.value.status === 'protected' ||
                  previous?.value.status === 'missing')
              )
                return previous;
              return {
                owner: selection,
                value,
                durationMs:
                  value.status === 'ready'
                    ? value.durationMs
                    : previous?.owner === selection
                      ? previous.durationMs
                      : (selection?.summary.durationMs ?? null),
              };
            })
          }
        />
      ) : null}
      <View style={styles.page}>
        {source ? (
          <AppText
            style={styles.title}
            accessibilityRole="header"
            testID="recording-detail-title"
          >
            {(generatedTitle?.id === source.id
              ? generatedTitle.value
              : source.title) ?? t('recording.library.untitled')}
          </AppText>
        ) : null}

        {metadata?.status === 'unavailable' ? (
          <AppText>{t('recording.detail.refreshUnavailable')}</AppText>
        ) : null}
        {source && selection ? (
          /* Stable route-owned panel slots keep transcript drafts and review requests mounted through window reflow. */
          <AdaptiveColumns
            primary={
              <View style={styles.group}>
                <RecordingPlaybackControls
                  active={focused}
                  recordingId={source.id}
                  durationMs={
                    presentation?.owner === selection
                      ? presentation.durationMs
                      : selection.summary.durationMs
                  }
                  playbackService={playback}
                  autoPlay={selection.autoPlay && !autoPlayConsumed}
                  onAutoPlayConsumed={() => setAutoPlayConsumed(true)}
                />
                <TranscriptEvidencePanel
                  key={source.id}
                  savedDetail
                  playSegment={segment =>
                    playback.playRange(
                      segment.recordingSourceId,
                      segment.audioRange.startMs,
                      segment.audioRange.endMs,
                    )
                  }
                  recordingSourceId={source.id}
                  deletionBusy={exportBusy || review.busy || deleteBusy}
                  onInteractionChange={setInteraction}
                  automaticTranscriptionStatus={
                    transcription.state?.sourceId === source.id
                      ? transcription.state.status
                      : undefined
                  }
                />
              </View>
            }
            secondary={
              <View style={styles.group}>
                <View
                  accessible={false}
                  importantForAccessibility="no"
                  style={materialLibraryStyles.divider}
                />
                <EncounterReviewPanel
                  key={source.id}
                  sourceId={source.id}
                  disabled={
                    interaction.busy ||
                    interaction.dirty ||
                    exportBusy ||
                    deleteBusy
                  }

                  onInteractionChange={setReview}
                  routeOwner={routeOwner}
                  onTitleSaved={
                    focused && routeOwner
                      ? value => setGeneratedTitle({ id: source.id, value })
                      : undefined
                  }
                  service={reviewService}
                />
                <RecordingExportPanel
                  savedDetail
                  active={focused}
                  routeOwner={routeOwner}
                  recordingSourceId={source.id}
                  onBusyChange={setExportBusy}
                  actionsDisabled={busy || dirty}
                />
                <SavedRecordingDeleteAction
                  source={source}
                  active={focused}
                  actionsDisabled={busy || dirty}
                  routeOwner={routeOwner}
                  onBusyChange={setDeleteBusy}
                  onDeleted={onBack}
                />
              </View>
            }
            testID="recording-review-layout"
          />
        ) : (
          <AppText>
            {t(
              metadata?.status === 'protected'
                ? 'recording.detail.protected'
                : metadata?.status === 'missing'
                  ? 'recording.detail.notFound'
                  : 'recording.transcript.noRecording',
            )}
          </AppText>
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
  group: { minWidth: 0, gap: 20 },
  title: { fontSize: 28, fontWeight: '700', color: appColors.primaryText },
});
