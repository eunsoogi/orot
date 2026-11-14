import type { ConversationWorkflowContinuation } from '../../ragConversation/conversationWorkflowContinuation';
type Store = ConversationWorkflowContinuation['persisted'];

/** Open the same retained-turn database only when the real graph starts, not when constructing runner options. */
export function lazyConversationContinuationStore(
  open: () => Promise<Store>,
): Store {
  let store: Store | undefined;
  const ready = () => {
    if (!store) throw new Error('Continuation storage is not initialized.');
    return store;
  };
  return {
    get checkpointer() {
      return ready().checkpointer;
    },
    get threadId() {
      return ready().threadId;
    },
    get operationJournal() {
      return ready().operationJournal;
    },
    async initialize(options, signal, snapshotEvidence) {
      if (store)
        throw new Error('Continuation storage is already initialized.');
      store = await open();
      await store.initialize(options, signal, snapshotEvidence);
    },
    paused: checkpoint => ready().paused(checkpoint),
    claim: signal => ready().claim(signal),
  };
}
