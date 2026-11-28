import { providerSuccess } from '@orot/model-runtime';
import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import {
  requireSelectedAi,
  resolveSelectedAiProvider,
} from '../../aiFeatures/integration/provider';
import { providerSelectionStore } from '../../providers/selection/keychainSelectionStore';
import type { ProviderSelectionOption } from '../../providers/selection/types';

/** Use the real stock selection owner; replace only the local Keychain read and
 * Apple model implementation with fixture ports. A selection save retires old proof. */
export function possibilityBookmarkSelectedModel(
  option: ProviderSelectionOption,
  mode: string,
) {
  const selection = { providerId: option.provider.id, modelId: option.modelId };
  let read: jest.SpyInstance | undefined;
  return {
    async resolve() {
      read ??= jest
        .spyOn(providerSelectionStore, 'load')
        .mockResolvedValue(selection);
      return requireSelectedAi(
        await resolveSelectedAiProvider({
          loadAppleOption: async () => option,
          ...(mode === 'semantic-no-selection-proof'
            ? { selectionStore: providerSelectionStore }
            : {}),
        }),
      );
    },
    async confirm() {
      if (mode === 'semantic-stale-selection')
        await providerSelectionStore.save({
          ...selection,
          modelId: 'different-synthetic-option',
        });
      return true;
    },
    close: () => read?.mockRestore(),
  };
}

/** Mark only the protected reader's return, never the stored history envelope. */
export function markPossibilityProofOutput(
  storage: ReturnType<typeof createConversationArtifactStorage>,
) {
  const marker = 'synthetic-proof-only-original';
  return {
    probe: {
      ...storage,
      async readPossibilityOriginal(
        input: Parameters<typeof storage.readPossibilityOriginal>[0],
      ) {
        const original = await storage.readPossibilityOriginal(input);
        return original
          ? { ...original, trailing: original.trailing + marker }
          : null;
      },
    },
    expectNoMarker(value: unknown) {
      expect(JSON.stringify(value)).not.toMatch(
        new RegExp(marker + '|synthetic-possibility-turn-1'),
      );
    },
  };
}

export function syntheticNoPossibilityOriginal(answer: string) {
  return providerSuccess({
    text: JSON.stringify({
      type: 'result',
      value: { answerKind: 'conversation', answer },
      citations: [],
    }),
    toolCalls: [],
    finishReason: 'complete' as const,
  });
}
