import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { OpenAIAccountSummary } from '../openai';
import type { ChatGPTSelectionServices } from './chatGPTServices';
import { sortAccounts } from './flowHelpers';
import type { ProviderSelectionOption } from './types';

interface UseProviderSelectionAccountsOptions {
  readonly chatGPTServices: ChatGPTSelectionServices;
  readonly loadAppleOption: () => Promise<ProviderSelectionOption>;
  readonly refreshKey: number;
}

interface ProviderSelectionAccountState {
  readonly appleOption: ProviderSelectionOption | null;
  readonly options: readonly ProviderSelectionOption[];
  readonly setOptions: Dispatch<
    SetStateAction<readonly ProviderSelectionOption[]>
  >;
  readonly accounts: readonly OpenAIAccountSummary[];
  readonly selectedAccountID: string | null;
  readonly setSelectedAccountID: Dispatch<SetStateAction<string | null>>;
  readonly accountListReady: boolean;
  readonly accountListError: boolean;
  readonly setAccountListError: Dispatch<SetStateAction<boolean>>;
  readonly setAccounts: Dispatch<
    SetStateAction<readonly OpenAIAccountSummary[]>
  >;
  readonly refreshAccounts: (
    preferredID?: string,
  ) => Promise<readonly OpenAIAccountSummary[]>;
}

/** Owns linked-account and model-catalog state, refreshing it after account-route return. */
export function useProviderSelectionAccounts({
  chatGPTServices,
  loadAppleOption,
  refreshKey,
}: UseProviderSelectionAccountsOptions): ProviderSelectionAccountState {
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

  useEffect(() => {
    let mounted = true;
    // Remove cached account/model choices before reading the latest linked-account state.
    setAppleOption(null);
    setOptions([]);
    setAccounts([]);
    setSelectedAccountID(null);
    setAccountListError(false);
    setAccountListReady(false);
    loadAppleOption().then(option => {
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
  }, [chatGPTServices, loadAppleOption, refreshKey]);

  const refreshAccounts = useCallback(
    async (preferredID?: string): Promise<readonly OpenAIAccountSummary[]> => {
      const nextAccounts = sortAccounts(await chatGPTServices.listAccounts());
      setAccounts(nextAccounts);
      setSelectedAccountID(currentID => {
        if (
          preferredID &&
          nextAccounts.some(account => account.issuedClientID === preferredID)
        ) {
          return preferredID;
        }
        return nextAccounts.some(
          account => account.issuedClientID === currentID,
        )
          ? currentID
          : nextAccounts.length === 1
            ? (nextAccounts[0]?.issuedClientID ?? null)
            : null;
      });
      setAccountListError(false);
      return nextAccounts;
    },
    [chatGPTServices],
  );

  return {
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
  };
}
