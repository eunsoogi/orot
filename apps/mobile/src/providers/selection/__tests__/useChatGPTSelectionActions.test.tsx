import { act, renderHook } from '@testing-library/react-native';
import { providerSuccess } from '@orot/model-runtime';
import type { OpenAIAccountSummary, OpenAISignOutResult } from '../../openai';
import type { ChatGPTSelectionServices } from '../chatGPTServices';
import { useChatGPTSelectionActions } from '../useChatGPTSelectionActions';

describe('useChatGPTSelectionActions', () => {
  it('sends one sign-out when duplicate calls arrive before a rerender', async () => {
    const account: OpenAIAccountSummary = {
      issuedClientID: 'synthetic-account',
      requiresSignIn: false,
      hasDirectPlanAccess: true,
    };
    let finishSignOut!: (result: OpenAISignOutResult) => void;
    const signOut = jest.fn(
      () =>
        new Promise<OpenAISignOutResult>(resolve => {
          finishSignOut = resolve;
        }),
    );
    const services: ChatGPTSelectionServices = {
      listAccounts: jest.fn().mockResolvedValue([account]),
      listModels: jest.fn().mockResolvedValue(providerSuccess([])),
      signIn: jest.fn().mockResolvedValue(account),
      signOut,
      cancelSignIn: jest.fn(),
    };
    const { result } = await renderHook(() =>
      useChatGPTSelectionActions({
        accountListError: false,
        accountListReady: true,
        accounts: [account],
        appleOption: null,
        chatGPTServices: services,
        refreshAccounts: jest.fn().mockResolvedValue([account]),
        selectedAccountID: account.issuedClientID,
        setAccountListError: jest.fn(),
        setAccounts: jest.fn(),
        setOptions: jest.fn(),
      }),
    );

    let firstRequest!: Promise<void>;
    let duplicateRequest!: Promise<void>;
    await act(async () => {
      // Both calls precede a React render, so the ref guard prevents a same-tick duplicate.
      firstRequest = result.current.onSignOut(account.issuedClientID);
      duplicateRequest = result.current.onSignOut(account.issuedClientID);
      expect(signOut).toHaveBeenCalledTimes(1);
      finishSignOut('revoked');
      await Promise.all([firstRequest, duplicateRequest]);
    });

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(result.current.actionBusy).toBe(false);
  });
});
