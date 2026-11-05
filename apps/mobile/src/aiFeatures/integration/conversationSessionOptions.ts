import { createConversationSessionRetention } from '../../ragConversation/conversationSessionRetention';
import type { ConversationSessionOptions } from '../../ragConversation/conversationSessionTypes';
import { operationRunId } from './featureRunIdentity';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { captureConversationToolSources } from './captureConversationToolSources';
import { restoreConversationToolTurns } from './restoreConversationToolTurns';
import { fingerprint } from './evidenceUtils';

/** Bind the app-owned session store to encrypted writes and source-checked restoration. */
export function createConversationSessionOptions(input: {
  readonly loadLocalData: () => Promise<AiFeatureLocalData>;
  readonly registry: LocalEvidenceReferenceRegistry;
}): ConversationSessionOptions {
  let recovered: Promise<void> | undefined;
  const openStorage = async () => {
    const data = await input.loadLocalData();
    if (!data.openConversationArtifactStorage)
      throw new Error('Conversation storage is unavailable.');
    const storage = await data.openConversationArtifactStorage();
    // Recovery happens before beginTurn can dispatch a new tool, never during a live restoration.
    await (recovered ??= storage.recoverInterruptedToolEvents().catch(error => {
      recovered = undefined;
      throw error;
    }));
    return storage;
  };
  return {
    retention: createConversationSessionRetention({
      openStorage,
      createId: operationRunId,
      now: () => new Date().toISOString(),
      captureToolSources: async event =>
        captureConversationToolSources(
          event,
          input.registry,
          await openStorage(),
        ),
    }),
    restoreSession: async (sessionId, signal) => {
      const data = await input.loadLocalData();
      const discovery = data.conversationArtifactDiscovery
        ? await data.conversationArtifactDiscovery(input.registry)
        : null;
      if (!discovery)
        throw new Error('Conversation restoration is unavailable.');
      const version = await discovery.activeSessionVersion(sessionId);
      if (version === null) throw new Error('Conversation is unavailable.');
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
        if (page.unavailableCount)
          throw new Error('Conversation content is unavailable.');
        turns.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor && !signal.aborted);
      if (signal.aborted)
        throw new Error('Conversation restoration was cancelled.');
      const storage = await openStorage();
      const savedToolTurns = await storage.readToolTurns(sessionId, version);
      const toolTurns = await restoreConversationToolTurns(
        savedToolTurns,
        input.registry,
        data,
        signal,
        sessionId,
        storage,
      );
      // Content and tool events must not outlive a session deletion or source change during restoration.
      if (
        !(await discovery.revalidateSession(
          sessionId,
          version,
          turns,
          signal,
        )) ||
        fingerprint(await storage.readToolTurns(sessionId, version)) !==
          fingerprint(savedToolTurns)
      )
        throw new Error('Conversation content changed during restoration.');
      const restored = turns.reverse().map(turn => ({
        question: turn.question,
        answer: turn.answer,
        citations: turn.citations,
        completion: turn.status,
        toolMessageId: turn.id,
        toolEvents:
          toolTurns.find(toolTurn => toolTurn.messageId === turn.id)
            ?.toolEvents ?? [],
      }));
      // Interrupted tool-only turns have no validated prose, but remain visible and never running.
      for (const turn of toolTurns)
        if (!restored.some(item => item.toolMessageId === turn.messageId))
          restored.push({
            question: '',
            answer: '',
            citations: [],
            completion: 'partial',
            toolMessageId: turn.messageId,
            toolEvents: turn.toolEvents,
          });
      const times = new Map([
        ...turns.map(turn => [turn.id, turn.createdAt] as const),
        ...toolTurns.map(turn => [turn.messageId, turn.createdAt] as const),
      ]);
      return restored.sort(
        (a, b) =>
          times
            .get(a.toolMessageId)!
            .localeCompare(times.get(b.toolMessageId)!) ||
          a.toolMessageId.localeCompare(b.toolMessageId),
      );
    },
  };
}
