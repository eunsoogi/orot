import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { appColors } from '../layout/appColors';
import { useInferenceConsent } from '../agent/execution/useInferenceConsent';
import { EncounterReviewController } from './controller';
import type { EncounterReviewService, ReviewState } from './controller';
import { localEncounterReviewService } from './localService';
import { CandidatePanel } from './CandidatePanel';
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
  useEffect(() => {
    controller.activate();
    controller.restore();
    return () => controller.dispose();
  }, [controller]);
  useEffect(() => {
    onInteractionChange({ busy, dirty: state.status === 'pending' });
  }, [busy, state.status, onInteractionChange]);
  const pending = state.status === 'pending' ? state.pending : undefined;
  return (
    <View style={styles.panel} testID="encounter-review-panel">
      <View style={styles.header}>
        <AppText accessibilityRole="header" style={styles.title}>
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
      {pending ? (
        <View style={styles.candidates}>
          {state.candidates.map(candidate => (
            <CandidatePanel
              key={candidate.id}
              candidate={candidate}
              pending={pending}
              selected={state.selected.includes(candidate.id)}
              onToggle={() => controller.toggle(candidate.id)}
              onEdit={(field, text) =>
                controller.edit(candidate.id, field, text)
              }
            />
          ))}
        </View>
      ) : null}
      {pending ? (
        <View style={styles.actions}>
          <AppButton
            title={copy.save}
            disabled={
              disabled ||
              !state.selected.length ||
              state.candidates.some(
                candidate =>
                  state.selected.includes(candidate.id) &&
                  !candidate.text.trim(),
              )
            }
            onPress={() => controller.decide('approve')}
            testID="encounter-save"
          />
          <AppButton
            title={copy.deny}
            disabled={disabled}
            onPress={() => controller.decide('deny')}
            testID="encounter-deny"
            variant="secondary"
          />
        </View>
      ) : null}
      {!busy && !pending ? (
        <View style={styles.actions}>
          <AppButton
            title={
              state.status === 'idle' || state.status === 'no-transcript'
                ? copy.start
                : copy.restart
            }
            disabled={disabled}
            onPress={() => {
              controller.start(consent);
            }}
            testID="encounter-start"
          />
        </View>
      ) : null}
      {!busy && ['cancelled', 'unavailable'].includes(state.status) ? (
        <AppButton
          title={copy.restore}
          disabled={disabled}
          onPress={() => controller.restore()}
          testID="encounter-restore"
          variant="secondary"
        />
      ) : null}
      {busy && state.status !== 'loading' ? (
        <AppButton
          title={copy.cancel}
          onPress={() => controller.cancel()}
          testID="encounter-cancel"
          variant="secondary"
        />
      ) : null}
      {disclosureSheet}
    </View>
  );
}
const styles = StyleSheet.create({
  panel: {
    gap: 16,
    padding: 16,
    borderRadius: 16,
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderWidth: 1,
  },
  header: { gap: 8 },
  title: { fontSize: 18, fontWeight: '600', lineHeight: 24 },
  boundary: { color: appColors.secondary, lineHeight: 22 },
  status: { fontWeight: '500', lineHeight: 22 },
  candidates: { gap: 12 },
  actions: { gap: 12 },
});
