import type { ConversationSessionOptions } from '../../ragConversation/conversationSessionTypes';
import type { SelectedAiResolver } from './provider';
import type { createConversationSessionStorage } from './conversationSessionStorage';
import { createConversationDurableIdentity } from '../../ragConversation/conversationDurableIdentity';
import { observeHistoryStartup } from '../../providers/conversationHistoryDiagnostic';

/** Reuse the validated saved selection, not a label, refresh counter, credential or health payload. */
export function continuousSessionOption(
  selectedAi: SelectedAiResolver | undefined,
  openStorage: ReturnType<typeof createConversationSessionStorage>,
): Pick<ConversationSessionOptions, 'continuousSession'> {
  if (!selectedAi) return {};
  return {
    continuousSession: async (signal, historyStartup) => {
      const selected = await (historyStartup
        ? observeHistoryStartup('history_startup_model_selection', () =>
            selectedAi(true),
          )
        : selectedAi());
      if (signal.aborted) throw new Error('Conversation selection cancelled.');
      const model = {
        providerId: selected.provider.id,
        modelId: selected.modelId,
      };
      const storage = await openStorage();
      const readLease = () =>
        storage.continuousSession(
          model,
          createConversationDurableIdentity(),
          new Date().toISOString(),
          signal,
        );
      const lease = await (historyStartup
        ? observeHistoryStartup('history_startup_continuous_session', readLease)
        : readLease());
      return { ...lease, model };
    },
  };
}
