import {
  requireSelectedAi,
  resolveSelectedAiProvider,
} from '../../aiFeatures/integration/provider';
import { providerSelectionStore } from '../../providers/selection/keychainSelectionStore';
import type { ProviderSelectionOption } from '../../providers/selection/types';

/** Use the signed application's native selection owner except for the remote
 * negative, which supplies only a synthetic resolver receipt and never calls it. */
export function healthSummarySectionSelectedModel(
  option: ProviderSelectionOption,
  mode: string,
) {
  const model =
    mode === 'remote'
      ? { providerId: 'chatgpt-plan:synthetic', modelId: 'synthetic-remote' }
      : { providerId: option.provider.id, modelId: option.modelId };
  jest.spyOn(providerSelectionStore, 'load').mockResolvedValue(model);
  return {
    model,
    selectedAi: async () =>
      mode === 'remote'
        ? {
            status: 'ready' as const,
            option,
            provider: { ...option.provider, id: model.providerId },
            selection: model,
            modelId: model.modelId,
            recipient: 'Synthetic remote',
            remoteProcessing: true,
          }
        : requireSelectedAi(
            await resolveSelectedAiProvider({
              loadAppleOption: async () => option,
              ...(mode === 'no-selection-proof'
                ? { selectionStore: providerSelectionStore }
                : {}),
            }),
          ),
  };
}
