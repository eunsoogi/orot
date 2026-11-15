import { restoreColdConversationPreviews } from './restoreColdConversationEligibility';
import { createConversationSessionRetention } from '../../ragConversation/conversationSessionRetention';
import type { ConversationSessionOptions } from '../../ragConversation/conversationSessionTypes';
import { createConversationDurableIdentity } from '../../ragConversation/conversationDurableIdentity';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { captureConversationToolSources } from './captureConversationToolSources';
import { restoreConversationToolTurns } from './restoreConversationToolTurns';
import { fingerprint } from './evidenceUtils';
import { conversationStoredToolObserver } from './conversationStoredToolObserver';
import { restoreConversationVisitQuestions } from './restoreConversationVisitQuestions';
import type { AiFeatureServices } from './featureServices';
import { healthSourceDependencies } from '../../ragConversation/conversationHealthDeletion';
import { createTreatmentSourceResolver } from './resolveTreatmentSource';
import { restoreConversationTaskCards } from './restoreConversationTaskCards';
import { validateInterruptedPhotoInputs } from './conversationInterruptedPhotoValidation';
import { orderRestoredConversationTurns } from './conversationRestoredTurnOrder';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import { createConversationSessionStorage } from './conversationSessionStorage';
import { conversationPhotoPreparationOption } from './conversationPhotoPreparation';
import type { requireSelectedAi } from './provider';

/** Bind the app-owned session store to encrypted writes and source-checked restoration. */
export function createConversationSessionOptions(input: {
  readonly coldResume?: ConversationSessionOptions['coldResume'];
  readonly loadLocalData: () => Promise<AiFeatureLocalData>;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly selectedAi?: () => Promise<ReturnType<typeof requireSelectedAi>>;
  readonly restoreHealthSummary?: (
    reference: import('../../ragConversation/healthSummary').HealthSummaryReference,
  ) => Promise<
    import('../../ragConversation/healthSummary').HealthSummaryResult | null
  >;
  readonly loadSavedVisitQuestions?: AiFeatureServices['loadSavedVisitQuestions'];
}): ConversationSessionOptions {
  const openStorage = createConversationSessionStorage(input.loadLocalData);
  const photo = conversationPhotoPreparationOption(input);
  return {
    ...photo,
    coldResume: input.coldResume,
    execution: conversationExecutionNative() ?? undefined,
    listSessions: async cursor => (await openStorage()).listSessions(cursor),
    restoreTasks: async (sessionId, signal) => {
      const storage = await openStorage();
      return restoreConversationTaskCards(storage, sessionId, signal);
    },
    resolveTreatmentSource: createTreatmentSourceResolver(input),
    retention: createConversationSessionRetention({
      openStorage,
      createId: createConversationDurableIdentity,
      now: () => new Date().toISOString(),
      retirePhoto: photo.photoPreparation?.retirement.retire,
      captureToolSources: async (event, sessionId) =>
        captureConversationToolSources(
          event,
          input.registry,
          await openStorage(),
          sessionId,
        ),
      onToolEventStored: conversationStoredToolObserver(
        openStorage,
        input.loadLocalData,
        input.registry,
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
      const interrupted = await storage.listInterruptedRequests(
        sessionId,
        version,
      );
      await validateInterruptedPhotoInputs({
        requests: interrupted,
        storage,
        data,
        sessionId,
        version,
        signal,
      });
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
            ...(turn.submittedInput
              ? { submittedInput: turn.submittedInput }
              : {}),
            answer: turn.answer,
            citations: turn.citations,
            healthSources: healthSourceDependencies(
              turn.sources.map(
                source => input.registry.resolve(source) ?? source,
              ),
            ),
            completion: turn.status,
            ...(turn.entryIntent ? { entryIntent: turn.entryIntent } : {}),
            ...(turn.dailyReport ? { dailyReport: turn.dailyReport } : {}),
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
        if (
          !restored.some(item => item.toolMessageId === turn.messageId) &&
          !interrupted.some(item => item.id === turn.messageId)
        )
          restored.push({
            question: '',
            answer: '',
            citations: [],
            healthSources: [],
            completion: 'partial',
            toolMessageId: turn.messageId,
            toolEvents: turn.toolEvents,
          });
      for (const request of interrupted)
        if (!restored.some(item => item.toolMessageId === request.id))
          restored.push({
            question: request.question,
            ...(request.submittedInput
              ? { submittedInput: request.submittedInput }
              : {}),
            answer: '',
            citations: [],
            healthSources: [],
            completion: 'partial',
            toolMessageId: request.id,
            toolEvents:
              toolTurns.find(turn => turn.messageId === request.id)
                ?.toolEvents ?? [],
          });
      // Visit restoration performs additional reads; recheck the session after those reads too.
      if (
        signal.aborted ||
        !(await discovery.revalidateSession(
          sessionId,
          version,
          turns,
          signal,
        )) ||
        fingerprint(
          await storage.listInterruptedRequests(sessionId, version),
        ) !== fingerprint(interrupted)
      )
        throw new Error('Conversation content changed during restoration.');
      await validateInterruptedPhotoInputs({
        requests: interrupted,
        storage,
        data,
        sessionId,
        version,
        signal,
      });
      const times = new Map([
        ...turns.map(turn => [turn.id, turn.createdAt] as const),
        ...toolTurns.map(turn => [turn.messageId, turn.createdAt] as const),
        ...interrupted.map(request => [request.id, request.createdAt] as const),
      ]);
      return restoreColdConversationPreviews(
        input.coldResume,
        signal,
        orderRestoredConversationTurns(restored, times),
        interrupted,
        storage,
        sessionId,
        version,
      );
    },
  };
}
