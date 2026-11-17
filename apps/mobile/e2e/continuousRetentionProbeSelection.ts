import { InMemoryFakeLanguageModelProvider } from '@orot/model-runtime';
import type { SelectedAiResolution } from '../src/aiFeatures/integration/provider';

const provider = new InMemoryFakeLanguageModelProvider({
  id: 'synthetic',
  displayName: 'Synthetic continuous-entry provider',
});

/** Only the model selection is synthetic; production continuous identity and encrypted storage remain authoritative. */
export async function continuousRetentionProbeSelection(): Promise<
  Extract<SelectedAiResolution, { status: 'ready' }>
> {
  return {
    status: 'ready',
    selection: { providerId: provider.id, modelId: 'synthetic' },
    provider,
    modelId: 'synthetic',
    option: {
      provider,
      modelId: 'synthetic',
      displayName: 'Synthetic continuous-entry provider',
      privacyBoundary: 'on-device',
      availability: { status: 'available' },
    },
    recipient: 'Synthetic local test',
    remoteProcessing: false,
  };
}

/** Display all current choices without giving this persistence probe any external actions. */
export const continuousRetentionProbeChoices = {
  possibilities: () => {},
  visitQuestions: () => {},
  healthSummary: () => {},
};
