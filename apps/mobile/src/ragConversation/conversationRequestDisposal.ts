import type { ConversationSession } from './conversationSessionTypes';
import type { createConversationTurnActivity } from './conversationTurnActivity';
import type { createConversationActivity } from './conversationActivity';
import type { createConversationRequestLifetime } from './conversationRequestLifetime';
import type { PendingTurn } from './conversationSessionTypes';

/** Dispose only request-owned resources; a removed session cannot be revived. */
export function createConversationRequestDisposal(input: {
  controllers: Map<number, AbortController>;
  pendingTurns: Map<number, PendingTurn>;
  activities: Map<number, ReturnType<typeof createConversationTurnActivity>>;
  snapshots: Map<number, ReturnType<typeof createConversationActivity>>;
  lifetime: ReturnType<typeof createConversationRequestLifetime>;
  saveRecovery: { suspend: (id: number) => void; dispose: () => void };
  update: (id: number, change: Partial<ConversationSession>) => void;
}) {
  return {
    abandon(id: number) {
      input.saveRecovery.suspend(id);
      input.lifetime.interrupt(id, 'cancelled', true);
      input.controllers.get(id)?.abort();
      input.activities.get(id)?.finish('cancelled');
      input.snapshots.get(id)?.settle();
      input.snapshots.delete(id);
      input.controllers.delete(id);
      input.pendingTurns.delete(id);
      input.update(id, {
        busy: false,
        pendingMessage: null,
        artifactContinuation: null,
        requestActivity: null,
      });
    },
    dispose() {
      input.saveRecovery.dispose();
      input.controllers.forEach((controller, id) => {
        input.lifetime.interrupt(id, 'interrupted');
        controller.abort();
      });
      input.activities.forEach(activity => activity.finish('cancelled'));
      input.snapshots.forEach(snapshot => snapshot.settle());
      input.snapshots.clear();
      input.controllers.clear();
      input.pendingTurns.clear();
    },
  };
}
