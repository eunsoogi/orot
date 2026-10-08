import type { LanguageModelProvider } from '@orot/model-runtime';
import {
  createChatGPTSelectionOptions,
  loadAppleSelectionOption,
  resolveProviderSelection,
  visitRecommendationRequirements,
} from '../../providers/selection';
import type {
  ProviderSelection,
  ProviderSelectionOption,
  ProviderSelectionStore,
} from '../../providers/selection';
import type { ChatGPTSelectionServices } from '../../providers/selection/chatGPTServices';
import { nativeChatGPTSelectionServices } from '../../providers/selection/chatGPTServices';
import { providerSelectionStore } from '../../providers/selection/keychainSelectionStore';

export type SelectedAiResolution =
  | {
      readonly status: 'ready';
      readonly provider: LanguageModelProvider;
      readonly modelId: string;
      readonly recipient: string;
      readonly remoteProcessing: boolean;
    }
  | { readonly status: 'selection-required' | 'unavailable' };

export interface SelectedAiResolverOptions {
  readonly selectionStore?: ProviderSelectionStore;
  readonly chatGPTServices?: ChatGPTSelectionServices;
  readonly loadAppleOption?: typeof loadAppleSelectionOption;
}

const CHATGPT_PROVIDER_PREFIX = 'chatgpt-plan:';

/** Resolves only the saved provider/model pair; catalog or account failure never selects a substitute. */
export async function resolveSelectedAiProvider(
  options: SelectedAiResolverOptions = {},
): Promise<SelectedAiResolution> {
  const selectionStore = options.selectionStore ?? providerSelectionStore;
  const chatGPTServices =
    options.chatGPTServices ?? nativeChatGPTSelectionServices;
  let selection: ProviderSelection | null;
  try {
    selection = await selectionStore.load();
  } catch {
    return { status: 'unavailable' };
  }
  if (!selection) return { status: 'selection-required' };

  let appleOption: ProviderSelectionOption;
  try {
    appleOption = await (options.loadAppleOption ?? loadAppleSelectionOption)();
  } catch {
    return { status: 'unavailable' };
  }

  if (selection.providerId === appleOption.provider.id) {
    return readySelection(selection, [appleOption]);
  }

  const accountId = selectedChatGPTAccountId(selection);
  if (!accountId) return { status: 'unavailable' };

  try {
    const accounts = await chatGPTServices.listAccounts();
    const account = accounts.find(
      candidate => candidate.issuedClientID === accountId,
    );
    if (!account || account.requiresSignIn || !account.hasDirectPlanAccess) {
      return { status: 'unavailable' };
    }

    const models = await chatGPTServices.listModels(accountId);
    if (!models.ok) return { status: 'unavailable' };
    return readySelection(selection, [
      appleOption,
      ...createChatGPTSelectionOptions(accountId, models.value),
    ]);
  } catch {
    return { status: 'unavailable' };
  }
}

function selectedChatGPTAccountId(
  selection: ProviderSelection,
): string | undefined {
  if (!selection.providerId.startsWith(CHATGPT_PROVIDER_PREFIX))
    return undefined;
  const modelSuffix = `:${selection.modelId}`;
  if (!selection.providerId.endsWith(modelSuffix)) return undefined;
  const accountId = selection.providerId.slice(
    CHATGPT_PROVIDER_PREFIX.length,
    -modelSuffix.length,
  );
  return accountId.trim() === accountId && accountId.length > 0
    ? accountId
    : undefined;
}

function readySelection(
  selection: ProviderSelection,
  options: readonly ProviderSelectionOption[],
): SelectedAiResolution {
  const result = resolveProviderSelection(
    selection,
    options,
    visitRecommendationRequirements,
  );
  if (!result.ok) return { status: 'unavailable' };
  const selected = options.find(
    option =>
      option.provider.id === selection.providerId &&
      option.modelId === selection.modelId,
  );
  if (!selected) return { status: 'unavailable' };
  return {
    status: 'ready',
    provider: result.provider,
    modelId: selected.modelId,
    recipient:
      selected.privacyBoundary === 'on-device'
        ? '기기 안의 Apple Intelligence'
        : '선택한 ChatGPT 계정',
    remoteProcessing: selected.privacyBoundary === 'selected-context-remote',
  };
}

/** Lets the flow move to explicit provider selection without weakening a failed resolution. */
export class AiProviderSelectionError extends Error {
  constructor(readonly status: 'selection-required' | 'unavailable') {
    super(
      status === 'selection-required'
        ? 'AI를 선택해야 기능을 사용할 수 있어요.'
        : '선택한 AI를 사용할 수 없어요. 제공자와 모델을 다시 확인해 주세요.',
    );
    this.name = 'AiProviderSelectionError';
  }
}

export function requireSelectedAi(
  result: SelectedAiResolution,
): Extract<SelectedAiResolution, { status: 'ready' }> {
  if (result.status !== 'ready')
    throw new AiProviderSelectionError(result.status);
  return result;
}
