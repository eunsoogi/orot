import { t } from '../../i18n';
import {
  APPLE_PCC_PROVIDER_ID,
  loadPrivateCloudComputeOption,
} from '../../providers/selection/privateCloudCompute';
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

export interface OnDeviceSelectionWitness {
  isCurrent(): boolean;
  subscribe(listener: () => void): () => void;
}

export type SelectedAiResolution =
  | {
      readonly status: 'ready';
      /** Preserve the exact saved choice and validated privacy boundary for the route. */
      readonly selection: ProviderSelection;
      readonly option: ProviderSelectionOption;
      readonly provider: LanguageModelProvider;
      readonly modelId: string;
      readonly recipient: string;
      readonly remoteProcessing: boolean;
      readonly onDeviceSelectionWitness?: OnDeviceSelectionWitness;
    }
  | { readonly status: 'selection-required' | 'unavailable' };

export interface SelectedAiResolverOptions {
  readonly selectionStore?: ProviderSelectionStore;
  readonly chatGPTServices?: ChatGPTSelectionServices;
  readonly loadAppleOption?: typeof loadAppleSelectionOption;
  readonly loadPccOption?: typeof loadPrivateCloudComputeOption;
}

const CHATGPT_PROVIDER_PREFIX = 'chatgpt-plan:';

/** Resolves only the saved provider/model pair; catalog or account failure never selects a substitute. */
export async function resolveSelectedAiProvider(
  options: SelectedAiResolverOptions = {},
): Promise<SelectedAiResolution> {
  const selectionStore = options.selectionStore ?? providerSelectionStore;
  const selectionWitness = options.selectionStore
    ? null
    : providerSelectionStore.liveWitness();
  const chatGPTServices =
    options.chatGPTServices ?? nativeChatGPTSelectionServices;
  let selection: ProviderSelection | null;
  try {
    selection = await selectionStore.load();
  } catch {
    return { status: 'unavailable' };
  }
  if (!selection) return { status: 'selection-required' };

  // Resolve PCC independently from ChatGPT credentials and local model availability.
  if (selection.providerId === APPLE_PCC_PROVIDER_ID) {
    try {
      return readySelection(selection, [
        await (options.loadPccOption ?? loadPrivateCloudComputeOption)(),
      ]);
    } catch {
      return { status: 'unavailable' };
    }
  }

  const accountId = selectedChatGPTAccountId(selection);
  // A saved ChatGPT choice depends on its own account/catalog, not the unrelated
  // local Apple availability bridge. Keep exact model validation in both paths.
  if (!accountId) {
    try {
      const ready = readySelection(selection, [
        await (options.loadAppleOption ?? loadAppleSelectionOption)(),
      ]);
      // This witness is tied to the selection read above and never reissues after a change.
      if (
        ready.status === 'ready' &&
        !ready.remoteProcessing &&
        selectionWitness?.() === true
      )
        return {
          ...ready,
          onDeviceSelectionWitness: {
            isCurrent: selectionWitness,
            subscribe: listener =>
              providerSelectionStore.subscribeChanges(listener),
          },
        };
      return ready;
    } catch {
      return { status: 'unavailable' };
    }
  }

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
    selection,
    option: selected,
    provider: result.provider,
    modelId: selected.modelId,
    recipient:
      selected.privacyBoundary === 'on-device'
        ? t('nextVisit.recipient.onDevice')
        : selected.provider.id === APPLE_PCC_PROVIDER_ID
          ? t('provider.pcc.recipient')
          : t('nextVisit.recipient.chatgpt'),
    remoteProcessing: selected.privacyBoundary === 'selected-context-remote',
  };
}

/** Lets the flow move to explicit provider selection without weakening a failed resolution. */
export class AiProviderSelectionError extends Error {
  constructor(readonly status: 'selection-required' | 'unavailable') {
    super(
      status === 'selection-required'
        ? t('nextVisit.selection.required')
        : t('nextVisit.selection.unavailable'),
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
