import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../layout/AppText';
import { EncounterReviewActions } from './EncounterReviewActions';
import { materialLibraryStyles } from '../layout/MaterialLibraryRows';
import { appColors } from '../layout/appColors';
import { useInferenceConsent } from '../agent/execution/useInferenceConsent';
import {
  EncounterReviewController,
  hasPendingEncounterCandidates,
} from './controller';
import type { EncounterReviewService, ReviewState } from './controller';
import { localEncounterReviewService } from './localService';
import { EncounterCandidatePages } from './EncounterCandidatePages';
import { reviewCopy as copy } from './strings';

/** A source key, never geometry, owns this controller and its unsaved edits through route reflow. */
export function EncounterReviewPanel({
  sourceId,
  disabled,
  onInteractionChange,
  service = localEncounterReviewService,
}: {
  sourceId: string;
  disabled: boolean;
  onInteractionChange: (state: { busy: boolean; dirty: boolean }) => void;
  service?: EncounterReviewService;
}) {
  const [state, setState] = useState<ReviewState>({
    status: 'loading',
    candidates: [],
    selected: [],
  });
  const controller = useMemo(
    () => new EncounterReviewController(sourceId, service, setState),
    [sourceId, service],
  );
  const { consent, disclosureSheet } = useInferenceConsent();
  const busy = ['loading', 'running', 'saving'].includes(state.status);
  const reviewable = hasPendingEncounterCandidates(state);
  useEffect(() => {
    controller.activate();
    controller.restore();
    return () => controller.dispose();
  }, [controller]);
  useEffect(() => {
    onInteractionChange({ busy, dirty: reviewable });
  }, [busy, reviewable, onInteractionChange]);
  const pending = state.status === 'pending' ? state.pending : undefined;
  return (
    <View style={styles.panel} testID="encounter-review-panel">
      <View style={styles.header}>
        <AppText
          accessibilityRole="header"
          style={materialLibraryStyles.heading}
        >
          {copy.title}
        </AppText>
        <AppText style={styles.boundary}>{copy.boundary}</AppText>
      </View>
      <AppText
        accessibilityLiveRegion="polite"
        style={styles.status}
        testID="encounter-status"
      >
        {pending && !pending.candidates.length
          ? copy.empty
          : copy[state.status]}
      </AppText>
      {pending && reviewable ? (
        <EncounterCandidatePages
          key={pending.threadId}
          pending={pending}
          state={state}
          controller={controller}
          disabled={disabled}
        />
      ) : null}
      <EncounterReviewActions
        status={state.status}
        hasPending={reviewable}
        disabled={disabled}
        saveDisabled={
          disabled ||
          !state.selected.length ||
          state.candidates.some(
            candidate =>
              state.selected.includes(candidate.id) && !candidate.text.trim(),
          )
        }
        onStart={() => controller.start(consent)}
        onSave={() => controller.decide('approve')}
        onDeny={() => controller.decide('deny')}
        onRestore={() => controller.restore()}
        onCancel={() => controller.cancel()}
      />
      {disclosureSheet}
    </View>
  );
}
const styles = StyleSheet.create({
  panel: { gap: 12, minWidth: 0 },
  header: { gap: 8 },
  boundary: { color: appColors.secondary, lineHeight: 22 },
  status: { fontWeight: '500', lineHeight: 22 },
});
