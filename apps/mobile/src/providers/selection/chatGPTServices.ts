import {
  cancelOpenAISignIn,
  listOpenAIAccounts,
  listOpenAIPlanModels,
  signOutFromOpenAI,
  signInToOpenAI,
} from '../openai';

export interface ChatGPTSelectionServices {
  readonly listAccounts: typeof listOpenAIAccounts;
  readonly listModels: typeof listOpenAIPlanModels;
  readonly signIn: typeof signInToOpenAI;
  readonly signOut: typeof signOutFromOpenAI;
  readonly cancelSignIn: typeof cancelOpenAISignIn;
}

export const nativeChatGPTSelectionServices: ChatGPTSelectionServices = {
  listAccounts: listOpenAIAccounts,
  listModels: listOpenAIPlanModels,
  signIn: signInToOpenAI,
  signOut: signOutFromOpenAI,
  cancelSignIn: cancelOpenAISignIn,
};
