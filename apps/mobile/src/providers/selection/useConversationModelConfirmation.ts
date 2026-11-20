import { useModelSettingsReview } from '../../agent/execution/useModelSettingsReview';
import { useModelConsentSave } from '../../agent/execution/useModelConsentSave';
import type { SettingsSearchChoices } from '../../agent/execution/settingsSearchGrants';
import type { ProviderSelectionScreenProps } from './ProviderSelectionScreenProps';
import type { useProviderSelectionNavigationState } from './providerSelectionNavigationState';
import type {
  ProviderSelection,
  ProviderSelectionOption,
  ProviderSelectionResolution,
} from './types';

/** Owns the current model draft through the shared consent sheet and settings writer. */
export function useConversationModelConfirmation({
  presentation,
  navigationRouteKey,
  selectionStore,
  onSelectionCommitted,
  pendingSelection,
  pendingResolution,
  currentPendingOption,
  confirmationOption,
  searchChoices,
  saving,
  setSaving,
  setSaveError,
  setSavedSelection,
  setPendingOption,
  publishNavigationState,
}: Pick<
  ProviderSelectionScreenProps,
  | 'presentation'
  | 'navigationRouteKey'
  | 'selectionStore'
  | 'onSelectionCommitted'
> & {
  pendingSelection: ProviderSelection | null;
  pendingResolution: ProviderSelectionResolution | null;
  currentPendingOption: ProviderSelectionOption | undefined;
  confirmationOption: ProviderSelectionOption | null;
  searchChoices: SettingsSearchChoices;
  saving: boolean;
  setSaving: (value: boolean) => void;
  setSaveError: (value: boolean) => void;
  setSavedSelection: (value: ProviderSelection) => void;
  setPendingOption: (value: ProviderSelectionOption | null) => void;
  publishNavigationState: ReturnType<
    typeof useProviderSelectionNavigationState
  >;
}) {
  const saveConsent = useModelConsentSave('conversation', selectionStore);
  const settings = presentation === 'settings-provider';
  const consent = useModelSettingsReview(
    'conversation',
    settings,
    selectionStore,
    JSON.stringify([
      presentation,
      navigationRouteKey,
      pendingSelection,
      pendingResolution?.ok,
      confirmationOption?.privacyBoundary,
      Boolean(confirmationOption?.provider.searchPublicWeb),
      searchChoices,
    ]),
    selectionStore,
  );
  async function confirmSelection() {
    if (
      !currentPendingOption ||
      !pendingSelection ||
      saving ||
      consent.isReviewing() ||
      !pendingResolution?.ok
    )
      return;
    const selection = pendingSelection;
    publishNavigationState({
      hasPendingSelection: true,
      isSavingSelection: true,
    });
    setSaving(true);
    setSaveError(false);
    let selectionSaved = false;
    try {
      const search = {
        ...searchChoices,
        web:
          searchChoices.web &&
          Boolean(currentPendingOption.provider.searchPublicWeb),
      };
      const saved = await consent.review(
        currentPendingOption,
        search,
        isCurrent => saveConsent(currentPendingOption, search, isCurrent),
      );
      if (!saved) return;
      setSavedSelection(selection);
      setPendingOption(null);
      selectionSaved = true;
      publishNavigationState(
        { hasPendingSelection: false, isSavingSelection: false },
        true,
      );
      setSaving(false);
      // Loading a saved choice never routes a provider; only explicit confirmation does.
      onSelectionCommitted?.(selection, pendingResolution.provider);
    } catch {
      setSaveError(true);
    } finally {
      if (!selectionSaved) {
        publishNavigationState({
          hasPendingSelection: true,
          isSavingSelection: false,
        });
      }
      setSaving(false);
    }
  }

  return {
    settings,
    confirmSelection: () => {
      confirmSelection();
    },
    disclosureSheet: consent.disclosureSheet,
  };
}
