import {
  chatGPTCredentialMutation,
  readChatGPTConsentCredential,
} from '../chatGPTConsentIdentity';
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
  conversationQuickReview = false,
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
  | 'conversationQuickReview'
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
  const unifiedReview = settings || conversationQuickReview;
  const consent = useModelSettingsReview(
    'conversation',
    unifiedReview,
    selectionStore,
    JSON.stringify([
      presentation,
      conversationQuickReview,
      navigationRouteKey,
      pendingSelection,
      pendingResolution?.ok,
      confirmationOption?.privacyBoundary,
      Boolean(confirmationOption?.provider.searchPublicWeb),
      searchChoices,
    ]),
    selectionStore,
    settings,
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
    const titleOwner = selection.providerId.startsWith('chatgpt-plan:')
      ? chatGPTCredentialMutation.capture()
      : undefined;
    publishNavigationState({
      hasPendingSelection: true,
      isSavingSelection: true,
    });
    setSaving(true);
    setSaveError(false);
    let selectionSaved = false;
    try {
      const remote =
        currentPendingOption.privacyBoundary === 'selected-context-remote';
      const search = {
        // A fresh local quick choice must not enable any external scope.
        // The shared sheet still discloses search when changing to a remote model.
        medical:
          settings ||
          (conversationQuickReview && remote) ||
          searchChoices.medical,
        web:
          unifiedReview &&
          remote &&
          Boolean(currentPendingOption.provider.searchPublicWeb),
      };
      const saved = await consent.review(
        currentPendingOption,
        search,
        (isCurrent, reviewedPhoto) =>
          saveConsent(currentPendingOption, search, isCurrent, reviewedPhoto),
      );
      if (!saved) return;
      // Capture the selected row only after explicit confirmation, under the
      // original account mutation witness. Copy failure must not undo consent.
      if (titleOwner?.() && selectionStore.rememberTitle) {
        try {
          const credential = await readChatGPTConsentCredential();
          if (titleOwner() && credential?.isCurrent())
            await selectionStore.rememberTitle(
              selection,
              {
                name: currentPendingOption.displayName.trim(),
                epoch: credential.epoch,
              },
              () => titleOwner() && credential.isCurrent(),
            );
        } catch {
          // The saved pair and authorization remain authoritative.
        }
      }
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
    unifiedReview,
    confirmSelection: () => {
      confirmSelection();
    },
    disclosureSheet: consent.disclosureSheet,
  };
}
