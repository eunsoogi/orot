import { createConversationSessionRetention } from '../../ragConversation/conversationSessionRetention';
import type { ConversationSessionOptions } from '../../ragConversation/conversationSessionTypes';
import { operationRunId } from './featureRunIdentity';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { captureConversationToolSources } from './captureConversationToolSources';
import { restoreConversationToolTurns } from './restoreConversationToolTurns';
import { fingerprint } from './evidenceUtils';
import { bindLiveConversationToolSources } from './bindLiveConversationToolSources';
import { restoreConversationVisitQuestions } from './restoreConversationVisitQuestions';
import type { AiFeatureServices } from './featureServices';

/** Bind the app-owned session store to encrypted writes and source-checked restoration. */
export function createConversationSessionOptions(input: {
  readonly loadLocalData: () => Promise<AiFeatureLocalData>;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly restoreHealthSummary?: (
    reference: import('../../ragConversation/healthSummary').HealthSummaryReference,
  ) => Promise<
    import('../../ragConversation/healthSummary').HealthSummaryResult | null
  >;
  readonly loadSavedVisitQuestions?: AiFeatureServices['loadSavedVisitQuestions'];
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
      captureToolSources: async (event, sessionId) =>
        captureConversationToolSources(
          event,
          input.registry,
          await openStorage(),
          sessionId,
        ),
      onToolEventStored: async (event, sessionId) => {
        if (
          event.sources.some(source => source.sourceKind === 'external_medical')
        )
          await bindLiveConversationToolSources(
            event,
            sessionId,
            await openStorage(),
            await input.loadLocalData(),
            input.registry,
          );
      },
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
      const restored = await Promise.all(
        turns.reverse().map(async turn => {
          const visitQuestions =
            turn.visitQuestions && input.loadSavedVisitQuestions
              ? await restoreConversationVisitQuestions({
                  appointmentId: turn.visitQuestions.appointmentId,
                  candidates: turn.visitQuestions.candidates,
                  ownerKey: `${sessionId}:${turn.id}`,
                  loadSaved: input.loadSavedVisitQuestions,
                  registry: input.registry,
                  signal,
                })
              : undefined;
          return {
            question: turn.question,
            answer: turn.answer,
            citations: turn.citations,
            completion: turn.status,
            ...(turn.healthSummary
              ? {
                  healthSummary:
                    (await input.restoreHealthSummary?.(turn.healthSummary)) ??
                    null,
                }
              : {}),
            toolMessageId: turn.id,
            toolEvents:
              toolTurns.find(toolTurn => toolTurn.messageId === turn.id)
                ?.toolEvents ?? [],
            ...(visitQuestions
              ? { visitQuestions }
              : turn.visitQuestions
                ? { visitQuestionsUnavailable: true }
                : {}),
          };
        }),
      );
      if (
        !(await discovery.revalidateSession(sessionId, version, turns, signal))
      )
        throw new Error('Conversation content changed during restoration.');
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
      // Visit restoration performs additional reads; recheck the session after those reads too.
      if (
        signal.aborted ||
        !(await discovery.revalidateSession(sessionId, version, turns, signal))
      )
        throw new Error('Conversation content changed during restoration.');
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
