import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRecordingTitleEligibility } from '../recording/useRecordingTitleEligibility';
import { useRecordingTitleProposal } from '../recording/useRecordingTitleProposal';
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
import { t } from '../i18n';
import { reviewCopy as copy } from './strings';

/** A source key, never geometry, owns this controller and its unsaved edits through route reflow. */
export function EncounterReviewPanel({
  sourceId,
  disabled,
  onInteractionChange,
  routeOwner,
  onTitleSaved,
  service = localEncounterReviewService,
}: {
  sourceId: string;
  disabled: boolean;
  routeOwner?: NavigationRouteOwnership;
  onTitleSaved?: (title: string) => void;
  onInteractionChange: (state: { busy: boolean; dirty: boolean }) => void;
  service?: EncounterReviewService;
}) {
  const [state, setState] = useState<ReviewState>({
    status: 'loading',
    candidates: [],
    selected: [],
  });
  const { controller, owner } = useMemo(
    () => ({
      controller: new EncounterReviewController(sourceId, service, setState),
      owner: routeOwner,
    }),
    [sourceId, service, routeOwner],
  );
  const { consent, disclosureSheet } = useInferenceConsent();
  const title = useRecordingTitleProposal(sourceId, routeOwner, onTitleSaved);
  const titleEligible = useRecordingTitleEligibility(
    sourceId,
    routeOwner,
    Boolean(onTitleSaved),
  );
  const busy = ['loading', 'running', 'saving'].includes(state.status);
  const reviewable = hasPendingEncounterCandidates(state);
  const [activeController, setActiveController] =
    useState<EncounterReviewController>();
  useLayoutEffect(() => {
    let admitted = false;
    let retired = false;
    // The navigation owner broadcasts before the next React commit. Abort the
    // controller there so a held selection cannot dispatch from a retired route.
    const update = () => {
      if (retired) return;
      if (owner && !owner.isCurrent()) {
        if (!admitted) return;
        admitted = false;
        controller.dispose();
        setActiveController(undefined);
        setState({ status: 'unavailable', candidates: [], selected: [] });
        return;
      }
      if (admitted) return;
      // A declined leave may return this exact mounted route. Restore under a
      // fresh protected lifetime; never replay a retired callback or generation.
      admitted = true;
      controller.activate();
      controller.restore();
      setActiveController(controller);
    };
    const unsubscribe = owner?.subscribe(update);
    update();
    return () => {
      retired = true;
      unsubscribe?.();
      controller.dispose();
    };
  }, [controller, owner]);
  useEffect(() => {
    onInteractionChange({
      busy: busy || title.busy,
      dirty: reviewable || title.draft,
    });
  }, [busy, reviewable, title.busy, title.draft, onInteractionChange]);
  if (activeController !== controller) return null;
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
      {state.status === 'running' && state.completedBatches !== undefined ? (
        <AppText
          accessibilityLiveRegion="polite"
          testID="encounter-batch-progress"
        >
          {t('encounterReview.completedBatches', {
            count: state.completedBatches,
          })}
        </AppText>
      ) : null}
      {pending && reviewable ? (
        <EncounterCandidatePages
          key={pending.threadId}
          pending={pending}
          state={state}
          controller={controller}
          disabled={disabled || title.busy || title.draft}
        />
      ) : null}
      <EncounterReviewActions
        status={state.status}
        titleAction={
          routeOwner && titleEligible()
            ? {
                sourceId,
                owner: routeOwner,
                run: async () => {
                  if (titleEligible()) await title.start();
                },
                disabled: disabled || title.busy || title.draft,
              }
            : undefined
        }
        hasPending={reviewable}
        disabled={disabled || title.busy || title.draft}
        saveDisabled={
          disabled ||
          !state.selected.length ||
          state.candidates.some(
            candidate =>
              state.selected.includes(candidate.id) && !candidate.text.trim(),
          )
        }
        onStart={() => controller.start(consent)}
        onSave={() => pending && controller.decide('approve', pending)}
        onDeny={() => pending && controller.decide('deny', pending)}
        onRestore={() => controller.restore()}
        onCancel={() => controller.cancel()}
      />
      {title.view}
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
