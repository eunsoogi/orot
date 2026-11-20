import { createCredentialMutationOwner } from '../../../agent/execution/credentialMutation';
import { createAppleSelectionOption } from '../../../providers/selection/options';
import type { ChatGPTSelectionServices } from '../../../providers/selection/chatGPTServices';
import { providerSelectionStore } from '../../../providers/selection/keychainSelectionStore';
import { resolveSelectedAiProvider } from '../provider';

const apple = createAppleSelectionOption('available');

test.each(['unchanged', 'changed while loading'] as const)(
  'binds only an unchanged default on-device selection to its mutation owner: %s',
  async scenario => {
    const owner = createCredentialMutationOwner();
    const chatGPTServices: ChatGPTSelectionServices = {
      listAccounts: jest.fn(),
      listModels: jest.fn(),
      signIn: jest.fn(),
      signOut: jest.fn(),
      cancelSignIn: jest.fn(),
    };
    const load = jest
      .spyOn(providerSelectionStore, 'load')
      .mockImplementation(async () => {
        if (scenario === 'changed while loading') owner.begin()();
        return { providerId: apple.provider.id, modelId: apple.modelId };
      });
    const capture = jest
      .spyOn(providerSelectionStore, 'liveWitness')
      .mockImplementation(owner.capture);
    const subscribe = jest
      .spyOn(providerSelectionStore, 'subscribeChanges')
      .mockImplementation(owner.subscribe);
    try {
      const result = await resolveSelectedAiProvider({
        chatGPTServices,
        loadAppleOption: async () => apple,
      });
      if (result.status !== 'ready')
        throw new Error('Expected ready selection.');
      const witness = result.onDeviceSelectionWitness;
      if (scenario === 'changed while loading') {
        expect(witness).toBeUndefined();
      } else {
        if (!witness) throw new Error('Expected a bound local selection.');
        const invalidated = jest.fn();
        const stop = witness.subscribe(invalidated);
        try {
          expect(witness.isCurrent()).toBe(true);
          owner.begin()();
          expect(witness.isCurrent()).toBe(false);
          expect(invalidated).toHaveBeenCalledTimes(1);
        } finally {
          stop();
        }
      }
      expect(chatGPTServices.listAccounts).not.toHaveBeenCalled();
      expect(chatGPTServices.listModels).not.toHaveBeenCalled();
    } finally {
      subscribe.mockRestore();
      capture.mockRestore();
      load.mockRestore();
    }
  },
);
