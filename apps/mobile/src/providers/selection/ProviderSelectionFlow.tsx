import { useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import ProviderSelectionScreen from './ProviderSelectionScreen';
import { nativeChatGPTSelectionServices } from './chatGPTServices';
import type { ChatGPTSelectionServices } from './chatGPTServices';
import { useChatGPTSelectionActions } from './useChatGPTSelectionActions';
import {
  loadAppleSelectionOption,
  visitRecommendationRequirements,
} from './options';
import { providerSelectionText } from './text';
import { providerSelectionStore } from './keychainSelectionStore';
import { sortAccounts, useCancelSignInOnUnmount } from './flowHelpers';
import type {
  ChatGPTAccountSetup,
  ProviderSelection,
  ProviderSelectionOption,
  ProviderSelectionStore,
} from './types';
import type { OpenAIAccountSummary } from '../openai';

interface ProviderSelectionFlowProps {
  readonly selectionStore?: ProviderSelectionStore;
  readonly chatGPTServices?: ChatGPTSelectionServices;
  readonly onBack: () => void;
  readonly onSelectionCommitted?: (
    selection: ProviderSelection,
    provider: ProviderSelectionOption['provider'],
  ) => void;
}

export default function ProviderSelectionFlow({
  selectionStore = providerSelectionStore,
  chatGPTServices = nativeChatGPTSelectionServices,
  onBack,
  onSelectionCommitted,
}: ProviderSelectionFlowProps) {
  const [appleOption, setAppleOption] =
    useState<ProviderSelectionOption | null>(null);
  const [options, setOptions] = useState<readonly ProviderSelectionOption[]>(
    [],
  );
  const [accounts, setAccounts] = useState<readonly OpenAIAccountSummary[]>([]);
  const [selectedAccountID, setSelectedAccountID] = useState<string | null>(
    null,
  );
  const [accountListReady, setAccountListReady] = useState(false);
  const [accountListError, setAccountListError] = useState(false);
  useCancelSignInOnUnmount(chatGPTServices.cancelSignIn);

  useEffect(() => {
    let mounted = true;
    loadAppleSelectionOption().then(option => {
      if (!mounted) return;
      setAppleOption(option);
      setOptions([option]);
    });
    chatGPTServices
      .listAccounts()
      .then(nextAccounts => {
        if (!mounted) return;
        const sorted = sortAccounts(nextAccounts);
        setAccounts(sorted);
        setSelectedAccountID(
          sorted.length === 1 ? (sorted[0]?.issuedClientID ?? null) : null,
        );
      })
      .catch(() => {
        if (mounted) setAccountListError(true);
      })
      .finally(() => {
        if (mounted) setAccountListReady(true);
      });
    return () => {
      mounted = false;
    };
  }, [chatGPTServices]);

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

  async function refreshAccounts(
    preferredID?: string,
  ): Promise<readonly OpenAIAccountSummary[]> {
    const nextAccounts = sortAccounts(await chatGPTServices.listAccounts());
    setAccounts(nextAccounts);
    setSelectedAccountID(currentID => {
      if (
        preferredID &&
        nextAccounts.some(account => account.issuedClientID === preferredID)
      ) {
        return preferredID;
      }
      return nextAccounts.some(account => account.issuedClientID === currentID)
        ? currentID
        : nextAccounts.length === 1
          ? (nextAccounts[0]?.issuedClientID ?? null)
          : null;
    });
    setAccountListError(false);
    return nextAccounts;
  }

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
  };

  return (
    // This route is a window-edge root, so measure system insets before laying out its controls.
    <SafeAreaProvider style={styles.container}>
      <SafeAreaView
        edges={['top', 'right', 'bottom', 'left']}
        style={styles.safeArea}
      >
        <ProviderSelectionScreen
          chatGPTSetup={chatGPTSetup}
          onBack={onBack}
          onSelectionCommitted={onSelectionCommitted}
          options={options}
          requirements={visitRecommendationRequirements}
          selectionStore={selectionStore}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f8fa' },
  safeArea: { flex: 1 },
});
