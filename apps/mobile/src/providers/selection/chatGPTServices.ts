import {
  cancelOpenAISignIn,
  listOpenAIAccounts,
  listOpenAIPlanModels,
  signInToOpenAI,
} from '../openai';

export interface ChatGPTSelectionServices {
  readonly listAccounts: typeof listOpenAIAccounts;
  readonly listModels: typeof listOpenAIPlanModels;
  readonly signIn: typeof signInToOpenAI;
  readonly cancelSignIn: typeof cancelOpenAISignIn;
}

export const nativeChatGPTSelectionServices: ChatGPTSelectionServices = {
  listAccounts: listOpenAIAccounts,
  listModels: listOpenAIPlanModels,
  signIn: signInToOpenAI,
  cancelSignIn: cancelOpenAISignIn,
};
