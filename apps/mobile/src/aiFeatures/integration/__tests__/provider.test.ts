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
      provider: apple.provider,
      modelId: apple.modelId,
      remoteProcessing: false,
    });
  });
});
