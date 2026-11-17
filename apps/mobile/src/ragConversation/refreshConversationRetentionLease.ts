import type { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import type { ConversationRetentionSlot } from './conversationSessionTurns';

/** Rebind only the exact inactive local slot after storage proves the new live lease.
 * Old turn retry handles are discarded, never promoted to the new generation. */
export function refreshConversationRetentionLease(
  slots: Map<number, ConversationRetentionSlot>,
  open: () => Promise<ReturnType<typeof createConversationArtifactStorage>>,
  lifecycle: () => number,
) {
  return async (
    id: number,
    durableId: string,
    version: number,
    current: () => boolean,
  ) => {
    const prior = slots.get(id);
    const epoch = lifecycle();
    const valid = () =>
      current() &&
      lifecycle() === epoch &&
      slots.get(id) === prior &&
      !prior?.hidden;
    if (
      !prior ||
      prior.id !== durableId ||
      !Number.isSafeInteger(version) ||
      version < 0 ||
      !valid()
    )
      throw new Error('Conversation is unavailable.');
    const storage = await open();
    if (
      !valid() ||
      (await storage.activeSessionVersion(durableId)) !== version ||
      !valid()
    )
      throw new Error('Conversation is unavailable.');
    if (prior.version === version) return;
    for (const turn of prior.turns) turn.discardRetry();
    slots.set(id, {
      id: durableId,
      version,
      hidden: false,
      ready: Promise.resolve(),
      turns: new Set(),
    });
  };
}
