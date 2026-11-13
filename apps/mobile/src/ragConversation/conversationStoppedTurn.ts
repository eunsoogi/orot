import { getRagConversationCopy } from './copy';
import { restoreFailedPrompt, retainPartial } from './conversationFailedPrompt';
import type {
  ConversationSession,
  PendingTurn,
} from './conversationSessionTypes';
import type { createConversationRequestLifetime } from './conversationRequestLifetime';
import type { createConversationTurnActivity } from './conversationTurnActivity';

/** Keep partial display state bound to its original session. */
export function createRetainConversationPartial(
  find: (id: number) => ConversationSession,
  update: (id: number, change: Partial<ConversationSession>) => void,
  nextId: () => number,
) {
  return (id: number, activity: string, retainEmpty = false) =>
    retainPartial(find, update, nextId, id, activity, retainEmpty);
}

/** Keep the unfinished stream and distinguish an iOS interruption from an explicit stop. */
export function showStoppedConversationTurn(input: {
  id: number;
  status: 'cancelled' | 'interrupted';
  turn?: PendingTurn;
  find: (id: number) => ConversationSession;
  update: (id: number, change: Partial<ConversationSession>) => void;
  retainPartial: (id: number, activity: string, retainEmpty?: boolean) => void;
}) {
  const copy = getRagConversationCopy();
  input.retainPartial(
    input.id,
    input.status === 'interrupted'
      ? copy.progressInterrupted
      : copy.progressCancelled,
    true,
  );
  if (input.turn)
    restoreFailedPrompt(
      input.find,
      input.update,
      input.id,
      input.turn.question,
      input.turn.userMessageId,
      input.status === 'interrupted' ? copy.progressInterrupted : undefined,
      true,
      input.turn.restorePromptToComposer,
    );
  else input.update(input.id, { busy: false });
}

/** Abort one owner while allowing an already-started commit to settle first. */
export function createConversationStopHandler(input: {
  controllers: Map<number, AbortController>;
  pendingTurns: Map<number, PendingTurn>;
  activities: Map<number, ReturnType<typeof createConversationTurnActivity>>;
  snapshots: Map<
    number,
    ReturnType<
      typeof import('./conversationActivity').createConversationActivity
    >
  >;
  lifetime: ReturnType<typeof createConversationRequestLifetime>;
  find: (id: number) => ConversationSession;
  update: (id: number, change: Partial<ConversationSession>) => void;
  retainPartial: (id: number, activity: string, retainEmpty?: boolean) => void;
}) {
  return (
    id: number,
    settled = false,
    reason: 'cancelled' | 'interrupted' = 'cancelled',
  ) => {
    const controller = input.controllers.get(id);
    if (!controller) return;
    const turn = input.pendingTurns.get(id);
    const snapshot = input.snapshots.get(id);
    snapshot?.cancel();
    if (snapshot) input.update(id, { requestActivity: snapshot.getSnapshot() });
    const status = input.lifetime.status(id, controller) ?? reason;
    input.lifetime.interrupt(id, status);
    controller.abort();
    input.activities.get(id)?.finish('cancelled');
    if (
      (turn?.saving || turn?.summarySaving || turn?.summaryCommitted) &&
      !settled
    )
      return;
    input.controllers.delete(id);
    input.pendingTurns.delete(id);
    snapshot?.settle();
    if (input.snapshots.get(id) === snapshot) input.snapshots.delete(id);
    input.update(id, { artifactContinuation: null, requestActivity: null });
    showStoppedConversationTurn({ ...input, id, status, turn });
  };
}
