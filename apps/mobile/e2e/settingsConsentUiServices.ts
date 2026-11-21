import type { ModelSettingsServices } from '../src/agent/execution/ModelSettingsServices';
import type { ProviderSelectionOption } from '../src/providers/selection/types';
import {
  createSettingsConsentPersistenceFixture,
  consentFixtureDestinations,
} from './settingsConsentPersistenceFixture';

/** Only a synthetic catalog and never-invoked provider are exposed. Real UI saves
 * still pass through the same coordinator into the isolated protected stores. */
export function createSettingsConsentUiServices(
  input: Parameters<typeof createSettingsConsentPersistenceFixture>[0],
) {
  const fixture = createSettingsConsentPersistenceFixture(input);
  const voiceSelection = input.selection('voice');
  const services: ModelSettingsServices = {
    calendar: input.selection('calendar'),
    calendarOption(modelId) {
      return {
        ...options[0],
        modelId,
        displayName: 'Synthetic calendar model',
        provider: { ...options[0].provider, id: 'openai-api-decisions' },
      };
    },
    saveConsent: fixture.saveConsent,
    voice: {
      async load() {
        const selection = await voiceSelection.load();
        return {
          mode:
            selection?.providerId === 'openai-live' ? 'openai-api' : 'local',
          model: selection?.modelId ?? 'apple-system-speech',
          hasApiKey: true,
        };
      },
      async save(value) {
        if (
          value.expectedAccountRevision !== undefined &&
          value.expectedAccountRevision !== 1
        )
          throw new Error('Synthetic account changed');
        if ('apiKey' in value)
          throw new Error('Synthetic UI cannot replace credentials');
        await voiceSelection.save({
          providerId:
            value.mode === 'openai-api' ? 'openai-live' : 'apple-local-voice',
          modelId: value.model,
        });
      },
      accountStatus: async () => ({ connected: true, revision: 1 }),
      discoverModels: async signal => {
        if (signal?.aborted) throw new Error('Synthetic catalog cancelled');
        return {
          revision: 1,
          ids: ['gpt-6-luna', 'gpt-live-1.1'],
        };
      },
      subscribe: () => () => {},
    },
  };
  const destination = consentFixtureDestinations.conversation;
  const options: readonly ProviderSelectionOption[] = [
    {
      modelId: destination.modelId,
      displayName: 'Synthetic consent model',
      privacyBoundary: 'selected-context-remote',
      availability: { status: 'available' },
      provider: {
        id: destination.providerId,
        displayName: 'Synthetic consent provider',
        kind: 'language-model',
        capabilities: {
          inputTypes: ['text'],
          streaming: false,
          structuredOutput: false,
          toolCalling: false,
        },
        async generate() {
          throw new Error('Native settings fixture must never invoke a model');
        },
      },
    },
  ];
  return {
    services,
    options,
    fixture,
    selectionStore: input.selection('conversation'),
  };
}
