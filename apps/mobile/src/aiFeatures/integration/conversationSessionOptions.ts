import { createConversationSessionRetention } from '../../ragConversation/conversationSessionRetention';
import type { ConversationSessionOptions } from '../../ragConversation/conversationSessionTypes';
import { operationRunId } from './featureRunIdentity';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';

/** Bind the app-owned session store to encrypted writes and source-checked restoration. */
export function createConversationSessionOptions(input: {
  readonly loadLocalData: () => Promise<AiFeatureLocalData>;
  readonly registry: LocalEvidenceReferenceRegistry;
}): ConversationSessionOptions {
  const openStorage = async () => {
    const data = await input.loadLocalData();
    if (!data.openConversationArtifactStorage)
      throw new Error('Conversation storage is unavailable.');
    return data.openConversationArtifactStorage();
  };
  return {
    retention: createConversationSessionRetention({
      openStorage,
      createId: operationRunId,
      now: () => new Date().toISOString(),
    }),
    restoreSession: async (sessionId, signal) => {
      const data = await input.loadLocalData();
      const discovery = data.conversationArtifactDiscovery
        ? await data.conversationArtifactDiscovery(input.registry)
        : null;
      if (!discovery)
        throw new Error('Conversation restoration is unavailable.');
      const turns: Awaited<
        ReturnType<typeof discovery.readSession>
      >['items'][number][] = [];
      let cursor:
        { readonly createdAt: string; readonly id: string } | undefined;
      do {
        const page = await discovery.readSession({
          sessionId,
          ...(cursor ? { cursor } : {}),
          signal,
        });
        turns.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor && !signal.aborted);
      if (signal.aborted)
        throw new Error('Conversation restoration was cancelled.');
      return turns.reverse().map(turn => ({
        question: turn.question,
        answer: turn.answer,
        citations: turn.citations,
        completion: turn.status,
      }));
    },
  };
}
