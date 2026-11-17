import {
  restoreUnavailableHistoryTurns,
  revalidateUnavailableHistory,
} from './restoreUnavailableHistoryTurns';
import {
  restoreUnavailableToolTurns,
  excludeUnavailableToolRequests,
} from './restoreUnavailableToolTurns';
import type { RestoredTurn } from '../../ragConversation/conversationRestoredTurn';
import type { ConversationSessionOptionInput } from './conversationSessionOptionInput';
import { restoreColdConversationPreviews } from './restoreColdConversationEligibility';
import { restoreHistoryToolTurns } from './restoreHistoryToolTurns';
import { observeConversationHistory } from '../../providers/conversationHistoryDiagnostic';
import { fingerprint } from './evidenceUtils';
import { restoreConversationVisitQuestions } from './restoreConversationVisitQuestions';
import { healthSourceDependencies } from '../../ragConversation/conversationHealthDeletion';
import { validateInterruptedPhotoInputs } from './conversationInterruptedPhotoValidation';
import { orderRestoredConversationTurns } from './conversationRestoredTurnOrder';
import type { createConversationSessionStorage } from './conversationSessionStorage';
/** Share every source, interruption and lease guard between full compatibility reads and lazy pages. */
export async function restoreConversationSessionTurns(
  input: ConversationSessionOptionInput,
  openStorage: ReturnType<typeof createConversationSessionStorage>,
  sessionId: string,
  signal: AbortSignal,
  selection?: { ids: readonly string[]; version: number },
) {
  const data = await input.loadLocalData();
  const discovery = await data.conversationArtifactDiscovery?.(input.registry);
  if (!discovery) throw new Error('Conversation restoration is unavailable.');
  const version = await discovery.activeSessionVersion(sessionId);
  if (selection && selection.version !== version)
    throw new Error('Conversation changed during restoration.');
  if (version === null) throw new Error('Conversation is unavailable.');
  const turns: Awaited<
    ReturnType<typeof discovery.readSession>
  >['items'][number][] = [];
  const unavailableHistory: { id: string; createdAt: string }[] = [];
  let cursor: Parameters<typeof discovery.readSession>[0]['cursor'];
  do {
    const page = await observeConversationHistory(
      'history_artifacts',
      () =>
        discovery.readSession({
          sessionId,
          ...(cursor ? { cursor } : {}),
          signal,
          ...(selection ? { ids: selection.ids } : {}),
        }),
      signal,
    );
    if (page.unavailableCount !== (page.unavailableItems?.length ?? 0))
      throw new Error('Conversation content is unavailable.');
    unavailableHistory.push(...(page.unavailableItems ?? []));
    turns.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && !signal.aborted);
  if (signal.aborted)
    throw new Error('Conversation restoration was cancelled.');
  const storage = await openStorage();
  const savedToolSnapshot = await observeConversationHistory(
    'history_tool_read',
    () => storage.readToolTurnsSnapshot(sessionId, version, selection?.ids),
    signal,
  );
  const interrupted = await storage.listInterruptedRequests(
    sessionId,
    version,
    selection?.ids,
  );
  await validateInterruptedPhotoInputs({
    requests: interrupted,
    storage,
    data,
    sessionId,
    version,
    signal,
  });
  const toolSnapshot = await observeConversationHistory(
    'history_tool_restore',
    () =>
      restoreHistoryToolTurns(
        savedToolSnapshot.items,
        input.registry,
        data,
        signal,
        sessionId,
        storage,
      ),
    signal,
  );
  const toolTurns = toolSnapshot.items;
  // Content and tool events must not outlive a session deletion or source change during restoration.
  if (
    !(await discovery.revalidateSession(sessionId, version, turns, signal)) ||
    fingerprint(
      await storage.readToolTurnsSnapshot(sessionId, version, selection?.ids),
    ) !== fingerprint(savedToolSnapshot)
  )
    throw new Error('Conversation content changed during restoration.');
  const restored: (RestoredTurn & { toolMessageId: string })[] =
    await Promise.all(
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
          ...(turn.delivery ? { delivery: turn.delivery } : {}),
          ...(turn.submittedInput
            ? { submittedInput: turn.submittedInput }
            : {}),
          answer: turn.answer,
          ...(turn.initialResponse
            ? { initialResponse: turn.initialResponse }
            : {}),
          citations: turn.citations,
          healthSources: healthSourceDependencies(
            turn.sources.map(
              source => input.registry.resolve(source) ?? source,
            ),
          ),
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
  if (!(await discovery.revalidateSession(sessionId, version, turns, signal)))
    throw new Error('Conversation content changed during restoration.');
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
        interrupted: true,
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
        interrupted: true,
        toolMessageId: request.id,
        toolEvents:
          toolTurns.find(turn => turn.messageId === request.id)?.toolEvents ??
          [],
      });
  // Visit restoration performs additional reads; recheck the session after those reads too.
  if (
    signal.aborted ||
    !(await discovery.revalidateSession(sessionId, version, turns, signal)) ||
    fingerprint(
      await storage.listInterruptedRequests(sessionId, version, selection?.ids),
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
  const unavailable = [
    ...savedToolSnapshot.unavailable,
    ...toolSnapshot.unavailable,
  ];
  restoreUnavailableToolTurns(restored, unavailable);
  restoreUnavailableHistoryTurns(restored, unavailableHistory);
  await revalidateUnavailableHistory(storage, sessionId, unavailableHistory);
  const times = new Map([
    ...unavailable.map(item => [item.messageId, item.createdAt] as const),
    ...unavailableHistory.map(item => [item.id, item.createdAt] as const),
    ...turns.map(turn => [turn.id, turn.createdAt] as const),
    ...toolTurns.map(turn => [turn.messageId, turn.createdAt] as const),
    ...interrupted.map(request => [request.id, request.createdAt] as const),
  ]);
  const output = await restoreColdConversationPreviews(
    input.coldResume,
    signal,
    orderRestoredConversationTurns(restored, times),
    excludeUnavailableToolRequests(interrupted, [
      ...unavailable,
      ...unavailableHistory.map(item => ({ messageId: item.id })),
    ]),
    storage,
    sessionId,
    version,
  );
  // Even notices must match the final selected tool snapshot after visit/photo/cold reads.
  if (
    signal.aborted ||
    fingerprint(
      await storage.readToolTurnsSnapshot(sessionId, version, selection?.ids),
    ) !== fingerprint(savedToolSnapshot) ||
    signal.aborted
  )
    throw new Error('Conversation content changed during restoration.');
  return output;
}
