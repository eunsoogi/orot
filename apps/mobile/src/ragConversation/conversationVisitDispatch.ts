import type { ConversationEntryContext } from '../aiFeatures/integration/conversationIntent';
import type { RagConversationMessage } from './task';
import type { ConversationSessions } from './conversationSessions';
import type { ConversationScreenProps } from './ConversationScreenProps';
import { conversationEntryForSession } from './useConversationEntryIntent';
import { entryIntentSender } from './entryIntentSender';
import { conversationHistoryPayload } from './conversationHistoryPayload';
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

/** Entry intent starts one operation; later ordinary conversation turns do not regenerate questions. */
export function shouldPrepareVisitQuestions(
  context: ConversationEntryContext | undefined,
  history: readonly RagConversationMessage[],
): boolean {
  return context?.intent === 'visit-questions' && history.length === 0;
}

/** Resolve entry intent at send time so a different session cannot inherit it. */
export function sendConversationMessage(
  store: ConversationSessions,
  id: number,
  onSend: ConversationScreenProps['onSend'],
  prepare?: ConversationScreenProps['prepareVisitQuestions'],
) {
  const session = store.getSnapshot().sessions.find(item => item.id === id);
  const entry = conversationEntryForSession(store, id);
  if (
    prepare &&
    session?.draft.trim() &&
    !session.busy &&
    !session.restoring &&
    !session.retryingSave &&
    !session.restoreFailed &&
    !session.quarantined &&
    !(session.restoreAfterRetry && session.unsavedCount) &&
    entry &&
    shouldPrepareVisitQuestions(
      entry,
      conversationHistoryPayload(session.messages, session.draft.trim()),
    )
  ) {
    // Record ownership before storage preflight, which may fail before the sender is called.
    visitPreparationSender(store, id, prepare, entry);
  }
  return store.send(id, (question, history, signal, observer) => {
    const context =
      pendingVisits.get(store)?.get(id) ??
      conversationEntryForSession(store, id);
    if (
      prepare &&
      context &&
      (pendingVisits.get(store)?.has(id) ||
        shouldPrepareVisitQuestions(context, history))
    )
      return visitPreparationSender(store, id, prepare, context)(
        question,
        history,
        signal,
        observer,
        context,
      );
    return entryIntentSender(store, id, onSend)(
      question,
      history,
      signal,
      observer,
    );
  });
}
