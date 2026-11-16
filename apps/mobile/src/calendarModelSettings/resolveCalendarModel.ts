import { resolveSelectedAiProvider } from '../aiFeatures/integration/provider';
import type {
  SelectedAiResolution,
  SelectedAiResolverOptions,
} from '../aiFeatures/integration/provider';
import { calendarModelStore } from './calendarModelStore';
import { voiceSettingsStore } from '../voiceSettings/voiceSettingsStore';
import { createCalendarDecisionsOption } from './decisionsProvider';

/** Calendar classification never inherits or rewrites the conversation destination. */
export async function resolveCalendarModel(
  options: SelectedAiResolverOptions = {},
): Promise<SelectedAiResolution> {
  const store = options.selectionStore ?? calendarModelStore;
  try {
    const selection = await store.load();
    if (!selection) return { status: 'selection-required' };
    if (selection.providerId !== 'openai-api-decisions') {
      // Resolve the exact inspected choice once; a second Keychain read could mix destinations.
      return resolveSelectedAiProvider({
        ...options,
        selectionStore: {
          load: async () => selection,
          save: value => store.save(value),
          clear: () => store.clear(),
        },
      });
    }
    const account = await voiceSettingsStore.accountStatus();
    if (!account.connected || selection.modelId !== 'gpt-6-luna') {
      return { status: 'unavailable' };
    }
    const option = createCalendarDecisionsOption(
      selection.modelId,
      account.revision,
    );
    if (option.availability.status !== 'available')
      return { status: 'unavailable' };
    const original = option.provider;
    // A retained route must not send data with an obsolete saved destination.
    const provider: typeof original = {
      ...original,
      async generate(request, execution) {
        const current = await store.load();
        if (
          current?.providerId !== selection.providerId ||
          current.modelId !== selection.modelId
        ) {
          throw new Error('Calendar classification selection changed');
        }
        return original.generate(request, execution);
      },
    };
    return {
      status: 'ready',
      selection,
      option: { ...option, provider },
      provider,
      modelId: selection.modelId,
      recipient: 'OpenAI API',
      remoteProcessing: true,
    };
  } catch {
    return { status: 'unavailable' };
  }
}
