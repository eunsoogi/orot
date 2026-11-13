import type { ConversationEntryContext } from '../aiFeatures/integration/conversationIntent';
import type { ConversationSessions } from './conversationSessions';
import type { ConversationScreenProps } from './ConversationScreenProps';
import type { ConversationSession } from './conversationSessionTypes';
import { conversationEntryForSession } from './useConversationEntryIntent';
import { entryIntentSender } from './entryIntentSender';
import type { TreatmentConversationSender } from '../treatmentContext/treatmentConversationSender';

const pendingVisits = new WeakMap<
  ConversationSessions,
  Map<number, ConversationEntryContext>
>();

/** Explicit treatment actions use their own validated sender, never text-based routing. */
export function sendExplicitTreatmentMessage(
  store: ConversationSessions,
  id: number,
  sender: TreatmentConversationSender,
) {
  return store.send(id, (_question, _history, signal) =>
    dispatchExplicitTreatmentAction(sender, signal),
  );
}

/** Local safety inputs and results stay outside the ordinary conversation history. */
export function dispatchExplicitTreatmentAction(
  sender: TreatmentConversationSender,
  signal?: AbortSignal,
) {
  return sender('', [], signal);
}

/** Keep the operation identity until preparation succeeds, including cancellation and edited retries. */
export function visitPreparationSender(
  store: ConversationSessions,
  id: number,
  prepare: NonNullable<ConversationScreenProps['prepareVisitQuestions']>,
  context: ConversationEntryContext,
) {
  let pending = pendingVisits.get(store);
  if (!pending) {
    pending = new Map();
    pendingVisits.set(store, pending);
  }
  const entries = pending;
  entries.set(id, context);
  return async (
    ...args: Parameters<
      NonNullable<ConversationScreenProps['prepareVisitQuestions']>
    >
  ) => {
    const result = await prepare(args[0], args[1], args[2], args[3], context);
    if (
      !args[2]?.aborted &&
      result.status !== 'failure' &&
      result.status !== 'unavailable'
    )
      entries.delete(id);
    return result;
  };
}

/** Disable the explicit entry action while the session cannot safely accept a turn. */
export function canStartExplicitVisitPreparation(
  session: ConversationSession,
  context: ConversationEntryContext | undefined,
  prepare: ConversationScreenProps['prepareVisitQuestions'],
): boolean {
  return Boolean(
    prepare &&
    context?.intent === 'visit-questions' &&
    session.entryPrompt?.trim() &&
    !session.busy &&
    !session.restoring &&
    !session.retryingSave &&
    !(session.restoreAfterRetry && session.unsavedCount) &&
    !session.restoreFailed &&
    !session.quarantined &&
    !session.dailyReport &&
    !context.dailyReport,
  );
}

/** Start preparation within the session that owns the selected visit context. */
export function startExplicitVisitPreparation(
  store: ConversationSessions,
  id: number,
  prepare: ConversationScreenProps['prepareVisitQuestions'],
) {
  const session = store.getSnapshot().sessions.find(item => item.id === id);
  const context = conversationEntryForSession(store, id);
  if (
    !session ||
    !context ||
    !prepare ||
    !canStartExplicitVisitPreparation(session, context, prepare)
  )
    return;
  return store.sendPrompt(
    id,
    session.entryPrompt!,
    visitPreparationSender(store, id, prepare, context),
  );
}

/** Resolve entry intent at send time so a different session cannot inherit it. */
export function sendConversationMessage(
  store: ConversationSessions,
  id: number,
  onSend: ConversationScreenProps['onSend'],
  prepare?: ConversationScreenProps['prepareVisitQuestions'],
) {
  const session = store.getSnapshot().sessions.find(item => item.id === id);
  const sendEntry = entryIntentSender(store, id, onSend);
  return store.send(id, (question, history, signal, observer) => {
    if (observer?.photoInput)
      return sendEntry(question, history, signal, observer);
    // An explicitly selected report owns this turn instead of an earlier visit entry.
    if (session?.dailyReport) {
      pendingVisits.get(store)?.delete(id);
      return sendEntry(question, history, signal, observer);
    }
    const pending = pendingVisits.get(store);
    const context = pending?.get(id) ?? conversationEntryForSession(store, id);
    if (prepare && context && pending?.has(id))
      return visitPreparationSender(store, id, prepare, context)(
        question,
        history,
        signal,
        observer,
        context,
      );
    return sendEntry(question, history, signal, observer);
  });
}
