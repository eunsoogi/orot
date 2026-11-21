import type {
  ConversationSnapshot,
  ConversationSender,
  ConversationSessionOptions,
} from './conversationSessionTypes';
import type { ConversationInitialPageAdmission } from './conversationHistoryPage';
import type { SourceDeletionEvent } from '../storage/localDataClearEvents';

export type ContinuousConversationStore = {
  getSnapshot(): ConversationSnapshot;
  toolSourceSessionId(id: number): string | null;
  attachExisting(
    id: string,
    version: number,
    updatedAt: string,
    select?: boolean,
    current?: () => boolean,
    signal?: AbortSignal,
    initialAdmission?: ConversationInitialPageAdmission,
  ): Promise<number>;
  refreshLease(
    id: number,
    lease: { id: string; version: number },
    current: () => boolean,
    signal: AbortSignal,
  ): Promise<void>;
  select(id: number): void;
  cancel(id: number): void;
  remove(
    id: number,
  ): ReturnType<
    ReturnType<
      typeof import('./conversationSessionRemoval').createConversationSessionRemoval
    >['remove']
  >;
  refreshAfterSourceDeletion(
    event: SourceDeletionEvent,
    deferReloadId?: number,
  ): void;
  create(): void;
  dispose(): void;
  invalidateAll(): void;
  retryInitialRestore(
    id: number,
    durableId: string,
    signal: AbortSignal,
  ): Promise<void>;
  send(id: number, sender: ConversationSender): Promise<void>;
  sendPrompt(
    id: number,
    prompt: string,
    sender: ConversationSender,
  ): Promise<void>;
};

/** Match the live selected local session, never a soft-removed/refreshing lease. */
export function activeRestoringConversation(
  snapshot: ConversationSnapshot,
  retention?: ConversationSessionOptions['retention'],
) {
  const active = snapshot.sessions.find(item => item.id === snapshot.activeId);
  const lease = retention?.activeLease(snapshot.activeId);
  if (
    active?.restoring &&
    !active.quarantined &&
    !active.leaseRefreshRequired &&
    lease
  )
    return { sessionId: active.id, lease: { ...lease } };
  return undefined;
}

/** Join the current selection without dispatching into a stale or quarantined session. */
export function conversationSelectionReady(input: {
  enabled: boolean;
  snapshot(): ConversationSnapshot;
  synchronize(): Promise<void>;
  controller(): AbortController | undefined;
  disposed(): boolean;
  cancel(): void;
}) {
  return async (id: number, signal?: AbortSignal) => {
    if (signal?.aborted) return false;
    if (!input.enabled) return true;
    const work = input.synchronize();
    const expected = input.controller();
    const cancel = () => {
      if (input.controller() === expected) input.cancel();
    };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    try {
      await work;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
    if (
      signal?.aborted ||
      input.disposed() ||
      expected !== input.controller() ||
      expected?.signal.aborted
    )
      return false;
    const snapshot = input.snapshot();
    const session = snapshot.sessions.find(item => item.id === id);
    return (
      snapshot.activeId === id &&
      Boolean(session) &&
      !session?.quarantined &&
      !session?.modelSelectionPending &&
      !session?.modelSelectionFailed
    );
  };
}
