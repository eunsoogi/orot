import { useIsFocused } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { resolveSelectedAiProvider } from '../aiFeatures/integration/provider';
import type { SelectedAiResolverOptions } from '../aiFeatures/integration/provider';
import type { OpenAIAccountSummary } from '../providers/openai';
import { nativeChatGPTSelectionServices } from '../providers/selection/chatGPTServices';
import { providerSelectionText } from '../providers/selection/text';
import { t } from '../i18n';

/** Reads saved AI and account validity without starting sign-in or permission flows. */
export function useSettingsRouteSummaries(
  resolverOptions?: SelectedAiResolverOptions,
  selectedProvider = '',
) {
  const isFocused = useIsFocused();
  const chatGPTServices =
    resolverOptions?.chatGPTServices ?? nativeChatGPTSelectionServices;
  const [selectedAiSummary, setSelectedAiSummary] = useState(
    t('provider.selection.rowLoading'),
  );
  const [accountsSummary, setAccountsSummary] = useState(
    providerSelectionText.chatGPTChecking,
  );

  useEffect(() => {
    // The root Settings screen stays mounted under detail routes; refresh its read-only summaries on return.
    if (!isFocused) return;
    let current = true;
    setSelectedAiSummary(t('provider.selection.rowLoading'));
    setAccountsSummary(providerSelectionText.chatGPTChecking);

    // Selected-model validation and the accounts row share the same native account snapshot.
    const accountsRequest = Promise.resolve().then(() =>
      chatGPTServices.listAccounts(),
    );
    resolveSelectedAiProvider({
      ...resolverOptions,
      chatGPTServices: {
        ...chatGPTServices,
        listAccounts: () => accountsRequest,
      },
    })
      .then(selection => {
        if (!current) return;
        if (selection.status === 'ready') {
          // The committed root label tracks the latest choice; resolution first confirms it is still valid.
          setSelectedAiSummary(
            selectedProvider || selection.option.displayName,
          );
        } else if (selection.status === 'selection-required') {
          setSelectedAiSummary(providerSelectionText.selectPrompt);
        } else {
          // An unavailable read cannot confirm that a cached provider label is still current.
          setSelectedAiSummary(t('provider.selection.rowUnavailable'));
        }
      })
      .catch(() => {
        if (current)
          setSelectedAiSummary(t('provider.selection.rowUnavailable'));
      });

    // This read reports saved account validity only and never opens a sign-in flow.
    accountsRequest
      .then(accounts => {
        if (current) setAccountsSummary(summarizeAccounts(accounts));
      })
      .catch(() => {
        if (current) {
          setAccountsSummary(providerSelectionText.chatGPTAccountReadError);
        }
      });

    return () => {
      current = false;
    };
  }, [chatGPTServices, isFocused, resolverOptions, selectedProvider]);

  return { selectedAiSummary, accountsSummary };
}

function summarizeAccounts(accounts: readonly OpenAIAccountSummary[]): string {
  if (accounts.length === 0) {
    return t('provider.selection.chatGPTNoLinkedAccounts');
  }

  const signInRequired = accounts.filter(account => account.requiresSignIn);
  const missingScope = accounts.filter(
    account => !account.requiresSignIn && !account.hasDirectPlanAccess,
  );
  // Connection is shown only when both login and the required plan access are confirmed.
  const connected =
    accounts.length - signInRequired.length - missingScope.length;

  if (accounts.length === 1) {
    const account = accounts[0];
    if (account?.requiresSignIn) {
      return providerSelectionText.chatGPTAccountSignedOut;
    }
    if (account && !account.hasDirectPlanAccess) {
      return providerSelectionText.chatGPTAccountMissingScope;
    }
  }
  if (connected === accounts.length) {
    return t('provider.selection.chatGPTAccountsConnected', {
      count: connected,
    });
  }
  return t('provider.selection.chatGPTAccountsOverview', {
    connected,
    signInRequired: signInRequired.length,
    missingScope: missingScope.length,
  });
}
