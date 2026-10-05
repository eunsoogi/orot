import { useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import ProviderSelectionScreen from './ProviderSelectionScreen';
import { nativeChatGPTSelectionServices } from './chatGPTServices';
import type { ChatGPTSelectionServices } from './chatGPTServices';
import {
  createChatGPTSelectionOptions,
  loadAppleSelectionOption,
  visitRecommendationRequirements,
} from './options';
import { providerSelectionText } from './text';
import { providerSelectionStore } from './keychainSelectionStore';
import {
  isSignInCancelled,
  markAccountAsRequiringSignIn,
  sortAccounts,
  useCancelSignInOnUnmount,
} from './flowHelpers';
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
  const [actionBusy, setActionBusy] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [actionStatus, setActionStatus] = useState('');
  const [actionError, setActionError] = useState(false);
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

  async function performChatGPTAction() {
    if (actionBusy || !accountListReady || accountListError) return;
    const account = accounts.find(
      value => value.issuedClientID === selectedAccountID,
    );
    if (accounts.length > 0 && !account) {
      setActionStatus(providerSelectionText.chatGPTChooseAccount);
      setActionError(true);
      return;
    }

    setActionBusy(true);
    setActionError(false);
    setActionStatus(providerSelectionText.chatGPTChecking);
    try {
      if (!account || account.requiresSignIn || !account.hasDirectPlanAccess) {
        setSigningIn(true);
        const summary = await chatGPTServices.signIn(account?.issuedClientID);
        await refreshAccounts(summary.issuedClientID);
        setOptions(appleOption ? [appleOption] : []);
        setActionStatus(
          summary.hasDirectPlanAccess && !summary.requiresSignIn
            ? providerSelectionText.chatGPTLoginSuccess
            : providerSelectionText.chatGPTAccountMissingScope,
        );
        setActionError(!summary.hasDirectPlanAccess || summary.requiresSignIn);
        return;
      }

      const models = await chatGPTServices.listModels(account.issuedClientID);
      if (!models.ok) {
        // A failed remote catalog keeps ChatGPT unavailable; it never chooses Apple as a substitute.
        if (models.error.code === 'authentication_required') {
          // Catalog rejection may not update the cached native account summary.
          setAccounts(markAccountAsRequiringSignIn(account.issuedClientID));
        }
        setOptions(appleOption ? [appleOption] : []);
        setActionStatus(providerSelectionText.chatGPTModelsUnavailable);
        setActionError(true);
        return;
      }
      const remoteOptions = createChatGPTSelectionOptions(
        account.issuedClientID,
        models.value,
      );
      setOptions([...(appleOption ? [appleOption] : []), ...remoteOptions]);
      setActionStatus(providerSelectionText.chatGPTModelsLoaded);
    } catch (error) {
      if (isSignInCancelled(error)) {
        setActionStatus(providerSelectionText.chatGPTLoginCancelled);
        setActionError(false);
      } else {
        setOptions(appleOption ? [appleOption] : []);
        setActionStatus(providerSelectionText.chatGPTModelsUnavailable);
        setActionError(true);
        try {
          await refreshAccounts(selectedAccountID ?? undefined);
        } catch {
          setAccountListError(true);
        }
      }
    } finally {
      setSigningIn(false);
      setActionBusy(false);
    }
  }

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
      : actionStatus || accountStatus,
    statusIsError: accountListError || actionError,
    actionTitle,
    busy: actionBusy || !accountListReady,
    signingIn,
    actionDisabled:
      !accountListReady ||
      accountListError ||
      (accounts.length > 0 && selectedAccountID === null),
    onAccountSelected: issuedClientID => {
      setSelectedAccountID(issuedClientID);
      setActionStatus('');
      setActionError(false);
      setOptions(appleOption ? [appleOption] : []);
    },
    onAction: performChatGPTAction,
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
