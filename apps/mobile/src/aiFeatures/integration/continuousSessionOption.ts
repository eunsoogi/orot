import type { ConversationSessionOptions } from '../../ragConversation/conversationSessionTypes';
import type { requireSelectedAi } from './provider';
import type { createConversationSessionStorage } from './conversationSessionStorage';
import { createConversationDurableIdentity } from '../../ragConversation/conversationDurableIdentity';
import { observeHistoryStartup } from '../../providers/conversationHistoryDiagnostic';

/** Reuse the validated saved selection, not a label, refresh counter, credential or health payload. */
export function continuousSessionOption(
  selectedAi: (() => Promise<ReturnType<typeof requireSelectedAi>>) | undefined,
  openStorage: ReturnType<typeof createConversationSessionStorage>,
): Pick<ConversationSessionOptions, 'continuousSession'> {
  if (!selectedAi) return {};
  return {
    continuousSession: async signal => {
      const selected = await observeHistoryStartup(
        'history_startup_model_selection',
        selectedAi,
      );
      if (signal.aborted) throw new Error('Conversation selection cancelled.');
      const model = {
        providerId: selected.provider.id,
        modelId: selected.modelId,
      };
      const storage = await openStorage();
      const lease = await observeHistoryStartup(
        'history_startup_continuous_session',
        () =>
          storage.continuousSession(
            { providerId: selected.provider.id, modelId: selected.modelId },
            createConversationDurableIdentity(),
            new Date().toISOString(),
            signal,
          ),
      );
      return { ...lease, model };
    },
  };
}
