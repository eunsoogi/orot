import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ProviderSelectionFlowShell } from './ProviderSelectionFlowShell';
import ProviderSelectionScreen from './ProviderSelectionScreen';
import type { ProviderSelectionScreenNavigationState } from './providerSelectionNavigationState';
import { nativeChatGPTSelectionServices } from './chatGPTServices';
import type { ChatGPTSelectionServices } from './chatGPTServices';
import { useChatGPTSelectionActions } from './useChatGPTSelectionActions';
import {
  loadAppleSelectionOption,
  visitRecommendationRequirements,
} from './options';
import { providerSelectionText } from './text';
import { providerSelectionStore } from './keychainSelectionStore';
import { useCancelSignInOnUnmount } from './flowHelpers';
import { useProviderSelectionAccounts } from './useProviderSelectionAccounts';
import type {
  ChatGPTAccountSetup,
  ProviderSelection,
  ProviderSelectionOption,
  ProviderSelectionPresentation,
  ProviderSelectionStore,
} from './types';

interface ProviderSelectionFlowProps {
  readonly presentation?: ProviderSelectionPresentation;
  // Settings uses route-specific screens; AI keeps the combined feature flow.
  readonly screenTitle?: string;
  readonly screenIntroduction?: string;
  readonly navigationRouteKey?: string;
  readonly accountRefreshKey?: number;
  readonly selectionStore?: ProviderSelectionStore;
  readonly chatGPTServices?: ChatGPTSelectionServices;
  readonly loadAppleOption?: () => Promise<ProviderSelectionOption>;
  readonly safeAreaHandledByParent?: boolean;
  readonly onOpenAccounts?: () => void;
  readonly onBack: () => void;
  readonly onSelectionCommitted?: (
    selection: ProviderSelection,
    provider: ProviderSelectionOption['provider'],
  ) => void;
  readonly onNavigationStateChange?: (
    state: ProviderSelectionNavigationState,
  ) => void;
}

export interface ProviderSelectionNavigationState {
  readonly hasPendingSelection: boolean;
  readonly isSavingSelection: boolean;
  readonly isSigningIn: boolean;
  readonly revision: number;
  readonly inputRevision: number;
}

export default function ProviderSelectionFlow({
  presentation = 'feature',
  screenTitle,
  screenIntroduction,
  navigationRouteKey,
  accountRefreshKey = 0,
  selectionStore = providerSelectionStore,
  chatGPTServices = nativeChatGPTSelectionServices,
  loadAppleOption = loadAppleSelectionOption,
  safeAreaHandledByParent = false,
  onOpenAccounts,
  onBack,
  onSelectionCommitted,
  onNavigationStateChange,
}: ProviderSelectionFlowProps) {
  const {
    appleOption,
    options,
    setOptions,
    accounts,
    selectedAccountID,
    setSelectedAccountID,
    accountListReady,
    accountListError,
    setAccountListError,
    setAccounts,
    refreshAccounts,
  } = useProviderSelectionAccounts({
    chatGPTServices,
    loadAppleOption,
    refreshKey: accountRefreshKey,
  });
  useCancelSignInOnUnmount(chatGPTServices.cancelSignIn);

  const selectedAccount = accounts.find(
    account => account.issuedClientID === selectedAccountID,
  );
  const actionTitle = useMemo(() => {
    if (!accountListReady) return providerSelectionText.chatGPTChecking;
    if (accountListError) return providerSelectionText.chatGPTAccountReadError;
    if (accounts.length === 0) return providerSelectionText.chatGPTSignIn;
    if (!selectedAccount) return providerSelectionText.chatGPTChooseAccount;
    return selectedAccount.requiresSignIn ||
      !selectedAccount.hasDirectPlanAccess
      ? providerSelectionText.chatGPTReauthorize
      : providerSelectionText.chatGPTLoadModels;
  }, [accountListError, accountListReady, accounts.length, selectedAccount]);

  const actions = useChatGPTSelectionActions({
    accountListError,
    accountListReady,
    accounts,
    appleOption,
    chatGPTServices,
    refreshAccounts,
    selectedAccountID,
    setAccountListError,
    setAccounts,
    setOptions,
  });
  const navigationStateRef = useRef<ProviderSelectionNavigationState>({
    hasPendingSelection: false,
    isSavingSelection: false,
    isSigningIn: false,
    revision: 0,
    inputRevision: 0,
  });
  const publishNavigationState = useCallback(
    (updates: Partial<Omit<ProviderSelectionNavigationState, 'revision'>>) => {
      const current = navigationStateRef.current;
      const next = { ...current, ...updates };
      if (
        current.hasPendingSelection === next.hasPendingSelection &&
        current.isSavingSelection === next.isSavingSelection &&
        current.isSigningIn === next.isSigningIn &&
        current.inputRevision === next.inputRevision
      ) {
        return;
      }

      const updated = { ...next, revision: current.revision + 1 };
      navigationStateRef.current = updated;
      onNavigationStateChange?.(updated);
    },
    [onNavigationStateChange],
  );
  const reportSelectionState = useCallback(
    (state: ProviderSelectionScreenNavigationState) => {
      publishNavigationState(state);
    },
    [publishNavigationState],
  );

  // Only sign-in is canceled by the existing unmount hook; model reads and sign-out have different lifecycles.
  useEffect(() => {
    publishNavigationState({ isSigningIn: actions.signingIn });
  }, [actions.signingIn, publishNavigationState]);

  const accountStatus = selectedAccount?.requiresSignIn
    ? providerSelectionText.chatGPTAccountSignedOut
    : selectedAccount && !selectedAccount.hasDirectPlanAccess
      ? providerSelectionText.chatGPTAccountMissingScope
      : accounts.length === 0
        ? providerSelectionText.chatGPTNoAccounts
        : accounts.length > 1 && !selectedAccount
          ? providerSelectionText.chatGPTChooseAccount
          : '';
  const chatGPTSetup: ChatGPTAccountSetup = {
    presentation,
    accounts,
    selectedAccountID,
    statusMessage: accountListError
      ? providerSelectionText.chatGPTAccountReadError
      : actions.actionStatus || accountStatus,
    statusIsError: accountListError || actions.actionError,
    actionTitle,
    busy: actions.actionBusy || !accountListReady,
    signingIn: actions.signingIn,
    signingOut: actions.signingOut,
    actionDisabled:
      !accountListReady ||
      accountListError ||
      (accounts.length > 0 && selectedAccountID === null),
    onAccountSelected: issuedClientID => {
      setSelectedAccountID(issuedClientID);
      actions.clearStatus();
      setOptions(appleOption ? [appleOption] : []);
    },
    onAction: actions.onAction,
    onSignOut: actions.onSignOut,
    onCancelSignIn: chatGPTServices.cancelSignIn,
    onOpenAccounts,
  };

  return (
    <ProviderSelectionFlowShell
      safeAreaHandledByParent={safeAreaHandledByParent}
    >
      <ProviderSelectionScreen
        presentation={presentation}
        navigationRouteKey={navigationRouteKey}
        screenTitle={screenTitle}
        screenIntroduction={screenIntroduction}
        chatGPTSetup={chatGPTSetup}
        onBack={onBack}
        onNavigationStateChange={reportSelectionState}
        onSelectionCommitted={onSelectionCommitted}
        options={options}
        requirements={visitRecommendationRequirements}
        selectionStore={selectionStore}
      />
    </ProviderSelectionFlowShell>
  );
}
