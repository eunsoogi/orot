import type { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import type { ConversationCompletionIdentity } from '../storage/conversationCompletionReader';
import type { ConversationRetentionSlot } from './conversationSessionTurns';

type Storage = ReturnType<typeof createConversationArtifactStorage>;

/** Resolve only a restored local marker explicitly selected by the app-owned UI.
 * This is a local quote, not provider dispatch permission or a finalized turn. */
export function createConversationRetentionReadActions(
  openStorage: () => Promise<Storage>,
  slots: ReadonlyMap<number, ConversationRetentionSlot>,
) {
  return {
    async readCommittedCompletion(identity: ConversationCompletionIdentity) {
      return (await openStorage()).readCommittedCompletion(identity);
    },
    async readExplicitPriorVoiceContext(input: {
      readonly session: number;
      readonly marker: string;
      readonly isExplicitSelectionCurrent: () => boolean;
      readonly signal: AbortSignal;
    }) {
      const slot = slots.get(input.session);
      if (!slot?.ready || slot.hidden) return;
      const version = slot.version;
      const current = () =>
        !input.signal.aborted &&
        input.isExplicitSelectionCurrent() &&
        slots.get(input.session) === slot &&
        !slot.hidden &&
        slot.version === version;
      if (!current()) return;
      const storage = await openStorage();
      if (!current()) return;
      const answer = await storage.readExplicitObservedVoiceQuote(
        slot.id,
        version,
        input.marker,
        input.signal,
        current,
      );
      return current() ? answer : undefined;
    },
  };
}
