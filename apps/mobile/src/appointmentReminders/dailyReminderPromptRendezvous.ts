import { canSelectConversationChoice } from '../ragConversation/selectConversationChoice';
import { startConversationReportTurn } from '../ragConversation/startConversationReportTurn';
import type { ConversationScreenProps } from '../ragConversation/ConversationScreenProps';
import type { ConversationSessions } from '../ragConversation/conversationSessions';

type Admission = 'wait' | (() => void) | null;

type Claim = {
  readonly sessionId: number;
  readonly rootKey: string;
  readonly isCurrent: () => boolean;
};

/** A durable report receipt allows this transient, same-owner handoff, never a restored card. */
export function createDailyReminderPromptRendezvous() {
  let pending: Claim | null = null;
  let receiver: { rootKey: string; admit: (claim: Claim) => Admission } | null =
    null;
  const drain = () => {
    if (!pending) return;
    if (!pending.isCurrent()) {
      pending = null;
      return;
    }
    if (!receiver || receiver.rootKey !== pending.rootKey) return;
    const claim = pending;
    const admission = receiver.admit(claim);
    if (admission === 'wait') return;
    pending = null;
    admission?.();
  };
  return {
    drain,
    offer(claim: Claim) {
      pending = claim;
      drain();
    },
    mount(rootKey: string, admit: (claim: Claim) => Admission) {
      const owner = { rootKey, admit };
      receiver = owner;
      drain();
      return () => {
        if (receiver === owner) receiver = null;
      };
    },
  };
}

const byStore = new WeakMap<
  ConversationSessions,
  ReturnType<typeof createDailyReminderPromptRendezvous>
>();

export function dailyReminderPromptRendezvous(store: ConversationSessions) {
  let rendezvous = byStore.get(store);
  if (!rendezvous) {
    rendezvous = createDailyReminderPromptRendezvous();
    byStore.set(store, rendezvous);
  }
  return rendezvous;
}

export function mountDailyReminderConversationPrompt(
  store: ConversationSessions,
  rootKey: string,
  isVisible: () => boolean,
  sender: () => ConversationScreenProps['onSend'] | undefined,
) {
  return dailyReminderPromptRendezvous(store).mount(rootKey, claim => {
    const current = () =>
      claim.isCurrent() &&
      isVisible() &&
      store.getSnapshot().activeId === claim.sessionId;
    const send = sender();
    if (!claim.isCurrent() || store.getSnapshot().activeId !== claim.sessionId)
      return null;
    const session = store
      .getSnapshot()
      .sessions.find(s => s.id === claim.sessionId);
    if (
      !session ||
      session.draft ||
      session.busy ||
      session.preparingSend ||
      session.restoreFailed ||
      session.quarantined ||
      store.photoDrafts.get(session.id).status !== 'empty'
    )
      return null;
    if (
      !isVisible() ||
      !send ||
      session.restoring ||
      session.modelSelectionPending
    )
      return 'wait';
    if (!canSelectConversationChoice(store, session)) return null;
    return () => {
      startConversationReportTurn(store, current, send);
    };
  });
}
