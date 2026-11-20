import { providerSuccess } from '@orot/model-runtime';
import type { OpenAIAccountSummary } from '../src/providers/openai';
import type { ChatGPTSelectionServices } from '../src/providers/selection/chatGPTServices';
import { completeSyntheticAuthReturn } from './providerSelectionSignOutFixture';

let rejectPendingSignIn: ((reason: unknown) => void) | null = null;

export const syntheticChatGPTServices: ChatGPTSelectionServices = {
  listAccounts: async () => [],
  listModels: async () => providerSuccess([]),
  signIn: () =>
    new Promise<OpenAIAccountSummary>((_resolve, reject) => {
      rejectPendingSignIn = reject;
    }),
  signOut: async () => 'localCredentialsCleared',
  cancelSignIn: () => {
    rejectPendingSignIn?.(
      Object.assign(new Error('Synthetic ChatGPT login cancelled.'), {
        code: 'CHATGPT_AUTH_CANCELLED',
      }),
    );
    rejectPendingSignIn = null;
  },
};

// This fixture refreshes real native account summaries only after the system session returns.
let syntheticSignInCompleted = false;
let syntheticReturnedAccount: OpenAIAccountSummary | null = null;

export const syntheticSuccessfulChatGPTServices: ChatGPTSelectionServices = {
  listAccounts: async () =>
    syntheticSignInCompleted && syntheticReturnedAccount
      ? [syntheticReturnedAccount]
      : [],
  listModels: async () => providerSuccess([]),
  signIn: async () => {
    const account = await completeSyntheticAuthReturn();
    syntheticReturnedAccount = account;
    syntheticSignInCompleted = true;
    return account;
  },
  signOut: async () => 'localCredentialsCleared',
  cancelSignIn: () => undefined,
};

const syntheticMissingScopeAccount: OpenAIAccountSummary = {
  issuedClientID: 'synthetic-missing-scope-account',
  requiresSignIn: false,
  hasDirectPlanAccess: false,
};

// This layout fixture supplies a not-ready account without reading or changing Keychain state.
export const syntheticMissingScopeChatGPTServices: ChatGPTSelectionServices = {
  listAccounts: async () => [syntheticMissingScopeAccount],
  listModels: async () => providerSuccess([]),
  signIn: async () => syntheticMissingScopeAccount,
  signOut: async () => 'localCredentialsCleared',
  cancelSignIn: () => undefined,
};

// Start each synthetic callback scenario without inheriting a previous return.
export function resetSyntheticSignInReturn() {
  syntheticSignInCompleted = false;
  syntheticReturnedAccount = null;
}
