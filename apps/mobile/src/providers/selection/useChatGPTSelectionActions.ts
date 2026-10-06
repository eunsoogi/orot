import { useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { OpenAIAccountSummary } from '../openai';
import type { ChatGPTSelectionServices } from './chatGPTServices';
import { createChatGPTSelectionOptions } from './options';
import { providerSelectionText } from './text';
import { isSignInCancelled, markAccountAsRequiringSignIn } from './flowHelpers';
import type { ProviderSelectionOption } from './types';

interface ChatGPTSelectionActionsOptions {
  readonly accountListError: boolean;
  readonly accountListReady: boolean;
  readonly accounts: readonly OpenAIAccountSummary[];
  readonly appleOption: ProviderSelectionOption | null;
  readonly chatGPTServices: ChatGPTSelectionServices;
  readonly refreshAccounts: (
    preferredID?: string,
  ) => Promise<readonly OpenAIAccountSummary[]>;
  readonly selectedAccountID: string | null;
  readonly setAccountListError: Dispatch<SetStateAction<boolean>>;
  readonly setAccounts: Dispatch<
    SetStateAction<readonly OpenAIAccountSummary[]>
  >;
  readonly setOptions: Dispatch<
    SetStateAction<readonly ProviderSelectionOption[]>
  >;
}

export function useChatGPTSelectionActions({
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
}: ChatGPTSelectionActionsOptions) {
  const [actionBusy, setActionBusy] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [actionStatus, setActionStatus] = useState('');
  const [actionError, setActionError] = useState(false);
  // A ref closes the same-tick double-tap window before React can rerender disabled controls.
  const actionInProgress = useRef(false);
  const appleOnly = appleOption ? [appleOption] : [];

  async function onAction() {
    if (actionInProgress.current || !accountListReady || accountListError)
      return;
    const account = accounts.find(
      value => value.issuedClientID === selectedAccountID,
    );
    if (accounts.length > 0 && !account) {
      setActionStatus(providerSelectionText.chatGPTChooseAccount);
      setActionError(true);
      return;
    }

    actionInProgress.current = true;
    setActionBusy(true);
    setActionError(false);
    setActionStatus(providerSelectionText.chatGPTChecking);
    try {
      if (!account || account.requiresSignIn || !account.hasDirectPlanAccess) {
        setSigningIn(true);
        const summary = await chatGPTServices.signIn(account?.issuedClientID);
        await refreshAccounts(summary.issuedClientID);
        setOptions(appleOnly);
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
          setAccounts(markAccountAsRequiringSignIn(account.issuedClientID));
        }
        setOptions(appleOnly);
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
        setOptions(appleOnly);
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
      actionInProgress.current = false;
    }
  }

  async function onSignOut(issuedClientID: string) {
    if (actionInProgress.current || !accountListReady || accountListError)
      return;
    const accountIndex = accounts.findIndex(
      value => value.issuedClientID === issuedClientID,
    );
    const account = accounts[accountIndex];
    if (!account || account.requiresSignIn) return;

    actionInProgress.current = true;
    setActionBusy(true);
    setSigningOut(true);
    setActionError(false);
    setActionStatus(providerSelectionText.chatGPTSigningOut(accountIndex + 1));
    try {
      let result: Awaited<ReturnType<ChatGPTSelectionServices['signOut']>>;
      try {
        result = await chatGPTServices.signOut(issuedClientID);
      } catch {
        setActionStatus(
          providerSelectionText.chatGPTSignOutFailed(accountIndex + 1),
        );
        setActionError(true);
        try {
          await refreshAccounts(issuedClientID);
        } catch {
          // If account state cannot be reread, do not leave a stale signed-in model available.
          setAccounts(markAccountAsRequiringSignIn(issuedClientID));
          setOptions(appleOnly);
          setAccountListError(true);
        }
        return;
      }

      // Remove remote models immediately; the stored provider choice remains visibly unavailable.
      setAccounts(markAccountAsRequiringSignIn(issuedClientID));
      setOptions(appleOnly);
      setActionStatus(
        result === 'revoked'
          ? providerSelectionText.chatGPTSignOutRemoteConfirmed(
              accountIndex + 1,
            )
          : providerSelectionText.chatGPTSignOutLocalOnly(accountIndex + 1),
      );
      setActionError(false);
      try {
        await refreshAccounts(issuedClientID);
      } catch {
        setAccountListError(true);
      }
    } finally {
      setSigningOut(false);
      setActionBusy(false);
      actionInProgress.current = false;
    }
  }

  function clearStatus() {
    setActionStatus('');
    setActionError(false);
  }

  return {
    actionBusy,
    actionError,
    actionStatus,
    clearStatus,
    onAction,
    onSignOut,
    signingIn,
    signingOut,
  };
}
