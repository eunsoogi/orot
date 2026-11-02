import type { SelectedAiResolverOptions } from '../aiFeatures/integration/provider';
import {
  APPLE_FOUNDATION_MODEL_SELECTION_ID,
  createAppleSelectionOption,
} from '../providers/selection';
import { nativeChatGPTSelectionServices } from '../providers/selection/chatGPTServices';
import type { OpenAIAccountSummary } from '../providers/openai';

const appleOption = createAppleSelectionOption('available');

/** Supplies saved selection and account states without starting sign-in or permission flows. */
export function settingsRouteResolverOptions(
  selection: { providerId: string; modelId: string } | null = {
    providerId: appleOption.provider.id,
    modelId: APPLE_FOUNDATION_MODEL_SELECTION_ID,
  },
  listAccounts: () => Promise<readonly OpenAIAccountSummary[]> = async () => [],
): SelectedAiResolverOptions {
  return {
    selectionStore: {
      load: async () => selection,
      save: async () => undefined,
      clear: async () => undefined,
    },
    chatGPTServices: { ...nativeChatGPTSelectionServices, listAccounts },
    loadAppleOption: async () => appleOption,
  };
}
