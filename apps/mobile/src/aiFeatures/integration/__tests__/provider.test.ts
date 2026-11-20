import { createAppleSelectionOption } from '../../../providers/selection/options';
import type { ChatGPTSelectionServices } from '../../../providers/selection/chatGPTServices';
import type { ProviderSelectionStore } from '../../../providers/selection/types';
import { resolveSelectedAiProvider } from '../provider';

const apple = createAppleSelectionOption('available');
const chatGPTServices: ChatGPTSelectionServices = {
  listAccounts: jest.fn(async () => [
    {
      issuedClientID: 'account-1',
      requiresSignIn: false,
      hasDirectPlanAccess: true,
    },
  ]),
  listModels: jest.fn(async () => ({
    ok: true as const,
    value: [{ id: 'model-a', slug: 'model-a', displayName: 'Model A' }],
  })),
  signIn: jest.fn(),
  signOut: jest.fn(),
  cancelSignIn: jest.fn(),
};

function store(
  selection: { providerId: string; modelId: string } | null,
): ProviderSelectionStore {
  return {
    load: jest.fn(async () => selection),
    save: jest.fn(),
    clear: jest.fn(),
  };
}

describe('resolveSelectedAiProvider', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires a stored choice instead of selecting the available Apple provider', async () => {
    await expect(
      resolveSelectedAiProvider({
        selectionStore: store(null),
        chatGPTServices,
        loadAppleOption: async () => apple,
      }),
    ).resolves.toEqual({ status: 'selection-required' });
  });

  it('resolves the exact saved ChatGPT account and model for remote processing', async () => {
    const result = await resolveSelectedAiProvider({
      selectionStore: store({
        providerId: 'chatgpt-plan:account-1:model-a',
        modelId: 'model-a',
      }),
      chatGPTServices,
      loadAppleOption: async () => apple,
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready')
      throw new Error('Expected a ready provider.');
    expect(result.provider.id).toBe('chatgpt-plan:account-1:model-a');
    expect(result.selection).toEqual({
      providerId: 'chatgpt-plan:account-1:model-a',
      modelId: 'model-a',
    });
    expect(result.option).toMatchObject({
      displayName: 'Model A',
      privacyBoundary: 'selected-context-remote',
    });
    expect(result.modelId).toBe('model-a');
    expect(result.remoteProcessing).toBe(true);
    expect(chatGPTServices.listModels).toHaveBeenCalledWith('account-1');
  });

  it('does not fall back to Apple when the saved ChatGPT account is unavailable', async () => {
    const listAccounts = jest.fn(async () => []);
    const result = await resolveSelectedAiProvider({
      selectionStore: store({
        providerId: 'chatgpt-plan:missing:model-a',
        modelId: 'model-a',
      }),
      chatGPTServices: {
        ...chatGPTServices,
        listAccounts,
      },
      loadAppleOption: async () => apple,
    });

    expect(result).toEqual({ status: 'unavailable' });
    expect(listAccounts).toHaveBeenCalledTimes(1);
    expect(chatGPTServices.listModels).not.toHaveBeenCalled();
  });

  it('retains an on-device provider only when that exact saved model is available', async () => {
    const result = await resolveSelectedAiProvider({
      selectionStore: store({
        providerId: apple.provider.id,
        modelId: apple.modelId,
      }),
      chatGPTServices,
      loadAppleOption: async () => apple,
    });

    expect(result).toMatchObject({
      status: 'ready',
      selection: { providerId: apple.provider.id, modelId: apple.modelId },
      option: apple,
      provider: apple.provider,
      modelId: apple.modelId,
      remoteProcessing: false,
    });
  });
  it('resolves saved ChatGPT without waiting for unrelated Apple availability', async () => {
    let release!: (value: typeof apple) => void;
    const loadAppleOption = jest.fn(
      () =>
        new Promise<typeof apple>(resolve => {
          release = resolve;
        }),
    );
    const work = resolveSelectedAiProvider({
      selectionStore: store({
        providerId: 'chatgpt-plan:account-1:model-a',
        modelId: 'model-a',
      }),
      chatGPTServices,
      loadAppleOption,
    });
    // Observe ordering without timing thresholds or an unresolved promise on failure.
    await Promise.resolve();
    await Promise.resolve();
    const accountReadsBeforeApple = (chatGPTServices.listAccounts as jest.Mock)
      .mock.calls.length;
    release?.(apple);
    const result = await work;
    expect(accountReadsBeforeApple).toBe(1);
    expect(loadAppleOption).not.toHaveBeenCalled();
    expect(result.status).toBe('ready');
    expect(chatGPTServices.listModels).toHaveBeenCalledTimes(1);
  });

  it('keeps saved ChatGPT usable when unrelated Apple availability rejects', async () => {
    const result = await resolveSelectedAiProvider({
      selectionStore: store({
        providerId: 'chatgpt-plan:account-1:model-a',
        modelId: 'model-a',
      }),
      chatGPTServices,
      loadAppleOption: async () => {
        throw new Error('Synthetic unrelated availability');
      },
    });
    expect(result.status).toBe('ready');
    expect(chatGPTServices.listAccounts).toHaveBeenCalledTimes(1);
    expect(chatGPTServices.listModels).toHaveBeenCalledTimes(1);
  });

  it.each([
    'account-error',
    'signed-out',
    'no-entitlement',
    'catalog-error',
    'missing-model',
  ])('still rejects ChatGPT %s without substituting Apple', async failure => {
    const listAccounts = jest.fn(async () => {
      if (failure === 'account-error')
        throw new Error('Synthetic account failure');
      return [
        {
          issuedClientID: 'account-1',
          requiresSignIn: failure === 'signed-out',
          hasDirectPlanAccess: failure !== 'no-entitlement',
        },
      ];
    });
    const listModels = jest.fn(async () => {
      if (failure === 'catalog-error')
        throw new Error('Synthetic catalog failure');
      return { ok: true as const, value: [] };
    });
    const loadAppleOption = jest.fn(async () => apple);
    const result = await resolveSelectedAiProvider({
      selectionStore: store({
        providerId: 'chatgpt-plan:account-1:model-a',
        modelId: 'model-a',
      }),
      chatGPTServices: { ...chatGPTServices, listAccounts, listModels },
      loadAppleOption,
    });
    expect(result).toEqual({ status: 'unavailable' });
    expect(loadAppleOption).not.toHaveBeenCalled();
    expect(listAccounts).toHaveBeenCalledTimes(1);
    expect(listModels).toHaveBeenCalledTimes(
      ['catalog-error', 'missing-model'].includes(failure) ? 1 : 0,
    );
  });

  it.each(['unknown-provider', 'chatgpt-plan:account-1:other-model'])(
    'does not admit unknown or mismatched saved selection %s',
    async providerId => {
      expect(
        await resolveSelectedAiProvider({
          selectionStore: store({ providerId, modelId: 'model-a' }),
          chatGPTServices,
          loadAppleOption: async () => apple,
        }),
      ).toEqual({ status: 'unavailable' });
      expect(chatGPTServices.listAccounts).not.toHaveBeenCalled();
      expect(chatGPTServices.listModels).not.toHaveBeenCalled();
    },
  );

  it('still rejects the selected local model when its availability fails', async () => {
    expect(
      await resolveSelectedAiProvider({
        selectionStore: store({
          providerId: apple.provider.id,
          modelId: apple.modelId,
        }),
        chatGPTServices,
        loadAppleOption: async () => {
          throw new Error('Synthetic local failure');
        },
      }),
    ).toEqual({ status: 'unavailable' });
    expect(chatGPTServices.listAccounts).not.toHaveBeenCalled();
  });
});
