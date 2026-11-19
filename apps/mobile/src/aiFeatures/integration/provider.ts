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
import { observeHistoryStartup } from '../../providers/conversationHistoryDiagnostic';
import { chatGPTCredentialMutation } from '../../providers/chatGPTConsentIdentity';

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
    }
  | { readonly status: 'selection-required' | 'unavailable' };

export interface SelectedAiResolverOptions {
  readonly selectionStore?: ProviderSelectionStore;
  readonly chatGPTServices?: ChatGPTSelectionServices;
  readonly loadAppleOption?: typeof loadAppleSelectionOption;
  readonly loadPccOption?: typeof loadPrivateCloudComputeOption;
}

export type SelectedAiResolver = (
  historyStartup?: boolean,
) => Promise<Extract<SelectedAiResolution, { status: 'ready' }>>;

const CHATGPT_PROVIDER_PREFIX = 'chatgpt-plan:';

/** Resolves only the saved provider/model pair; catalog or account failure never selects a substitute. */
export async function resolveSelectedAiProvider(
  options: SelectedAiResolverOptions = {},
  historyStartup = false,
): Promise<SelectedAiResolution> {
  const selectionStore = options.selectionStore ?? providerSelectionStore;
  const chatGPTServices =
    options.chatGPTServices ?? nativeChatGPTSelectionServices;
  const observe: typeof observeHistoryStartup = historyStartup
    ? observeHistoryStartup
    : (_stage, work) => work();
  let selection: ProviderSelection | null;
  try {
    selection = await observe('history_startup_saved_selection_read', () =>
      selectionStore.load(),
    );
  } catch {
    return { status: 'unavailable' };
  }
  if (!selection) return { status: 'selection-required' };

  // Resolve PCC independently from ChatGPT credentials and local model availability.
  if (selection.providerId === APPLE_PCC_PROVIDER_ID) {
    try {
      return readySelection(selection, [
        await observe(
          'history_startup_model_availability',
          options.loadPccOption ?? loadPrivateCloudComputeOption,
        ),
      ]);
    } catch {
      return { status: 'unavailable' };
    }
  }

  const mayOverlap =
    historyStartup &&
    selectionStore === providerSelectionStore &&
    chatGPTServices === nativeChatGPTSelectionServices;
  const selectionCurrent = mayOverlap
    ? providerSelectionStore.liveWitness()
    : null;
  const previousAccountId = mayOverlap
    ? selectedChatGPTAccountId(selection)
    : undefined;
  const credentialsCurrent = previousAccountId
    ? chatGPTCredentialMutation.capture()
    : null;
  const loadAccounts = () =>
    observe('history_startup_account_eligibility', () =>
      chatGPTServices.listAccounts(),
    );
  type Accounts = Awaited<ReturnType<typeof loadAccounts>>;
  let pendingAccounts: Promise<Accounts | undefined> | undefined;
  let appleOption: ProviderSelectionOption;
  try {
    const pendingApple = observe(
      'history_startup_model_availability',
      options.loadAppleOption ?? loadAppleSelectionOption,
    );
    // After the exact stored selection is known, Apple availability and the
    // local account list can run together. Neither authorizes catalog access.
    // Consume an early account failure even if the Apple probe fails first.
    if (selectionCurrent && credentialsCurrent)
      pendingAccounts = Promise.resolve()
        .then(loadAccounts)
        .catch(() => undefined);
    appleOption = await pendingApple;
  } catch {
    return { status: 'unavailable' };
  }

  if (selection.providerId === appleOption.provider.id) {
    return readySelection(selection, [appleOption]);
  }

  const accountId = selectedChatGPTAccountId(selection);
  if (!accountId) return { status: 'unavailable' };

  try {
    const eligible = (accounts: Accounts | undefined) => {
      const account = accounts?.find(
        candidate => candidate.issuedClientID === accountId,
      );
      return account && !account.requiresSignIn && account.hasDirectPlanAccess;
    };
    const earlyAccounts = pendingAccounts ? await pendingAccounts : undefined;
    // Reuse only a positive observation from the same local owner and revision.
    // A changed or failed early read falls back to the original serial check.
    const earlyReady =
      previousAccountId === accountId &&
      selectionCurrent?.() &&
      credentialsCurrent?.() &&
      eligible(earlyAccounts);
    if (!earlyReady && !eligible(await loadAccounts()))
      return { status: 'unavailable' };

    // The native catalog reader still checks the exact account and current
    // direct-plan grant under its credential owner before the metadata request.
    const models = await observe('history_startup_model_catalog', () =>
      chatGPTServices.listModels(accountId),
    );
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
