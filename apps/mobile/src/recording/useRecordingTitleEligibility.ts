import { useLayoutEffect, useState } from 'react';
import { AppState } from 'react-native';
import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import { providerSelectionStore } from '../providers/selection/keychainSelectionStore';
import {
  APPLE_FOUNDATION_MODEL_SELECTION_ID,
  loadAppleSelectionOption,
} from '../providers/selection/options';

type Current = () => boolean;

/** Presentation only. The title service still owns the exact selection and native admission at tap. */
export function useRecordingTitleEligibility(
  sourceId: string,
  owner?: NavigationRouteOwnership,
  enabled = false,
) {
  const [proof, setProof] = useState<{
    sourceId: string;
    owner: NavigationRouteOwnership;
    current: Current;
  }>();
  useLayoutEffect(() => {
    if (!enabled || !owner?.isCurrent()) return;
    let revision = 0;
    let active = true;
    const refresh = () => {
      const request = ++revision;
      setProof(undefined);
      if (AppState.currentState !== 'active' || !owner.isCurrent()) return;
      const selected = providerSelectionStore.liveWitness();
      if (!selected) return;
      const current = () =>
        active &&
        request === revision &&
        AppState.currentState === 'active' &&
        owner.isCurrent() &&
        selected();
      const checkAvailability = async () => {
        const choice = await providerSelectionStore.load();
        if (
          !current() ||
          choice?.providerId !== APPLE_PROVIDER_ID ||
          choice.modelId !== APPLE_FOUNDATION_MODEL_SELECTION_ID
        )
          return;
        const option = await loadAppleSelectionOption();
        if (
          current() &&
          option.provider.id === choice.providerId &&
          option.modelId === choice.modelId &&
          option.privacyBoundary === 'on-device' &&
          option.availability.status === 'available'
        )
          setProof({ sourceId, owner, current });
      };
      checkAvailability().catch(() => {
        // An unavailable proof leaves the ordinary analysis controls in place.
      });
    };
    const stopSelection = providerSelectionStore.subscribeChanges(refresh);
    const stopOwner = owner.subscribe(refresh);
    const phase = AppState.addEventListener('change', refresh);
    refresh();
    return () => {
      active = false;
      stopSelection();
      stopOwner();
      phase.remove();
    };
  }, [enabled, owner, sourceId]);
  return () =>
    enabled &&
    proof?.sourceId === sourceId &&
    proof.owner === owner &&
    proof.current();
}
