import type { ConversationSessionOptions } from '../../ragConversation/conversationSessionTypes';
import type { ConversationSessionOptionInput } from './conversationSessionOptionInput';
import type { requireSelectedAi } from './provider';
import type { createConversationSessionStorage } from './conversationSessionStorage';
import { createConversationDurableIdentity } from '../../ragConversation/conversationDurableIdentity';

/** Reuse the validated saved selection, not a label, refresh counter, credential or health payload. */
export function continuousSessionOption(
  selectedAi: (() => Promise<ReturnType<typeof requireSelectedAi>>) | undefined,
  openStorage: ReturnType<typeof createConversationSessionStorage>,
  captureSelectionWitness?: ConversationSessionOptionInput['captureSelectionWitness'],
): Pick<ConversationSessionOptions, 'continuousSession'> {
  if (!selectedAi) return {};
  return {
    continuousSession: async signal => {
      const witness = captureSelectionWitness?.();
      const selected = await selectedAi();
      if (signal.aborted) throw new Error('Conversation selection cancelled.');
      const model = {
        providerId: selected.provider.id,
        modelId: selected.modelId,
      };
      const lease = await (
        await openStorage()
      ).continuousSession(
        { providerId: selected.provider.id, modelId: selected.modelId },
        createConversationDurableIdentity(),
        new Date().toISOString(),
        signal,
      );
      const current = witness?.(model.providerId);
      return {
        ...lease,
        model,
        ...(current ? { selectionCurrent: current } : {}),
      };
    },
  };
}
