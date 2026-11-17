import type { ConversationSnapshot } from './conversationSessionTypes';

/** Preserve pending task retry identities before invalidating their stale source reads. */
export function invalidateTasks(
  snapshot: ConversationSnapshot,
  tasks: { invalidateWrites(): void },
  refresh: { has(id: number): boolean; invalidate(): void },
) {
  tasks.invalidateWrites();
  const retry = new Set(
    snapshot.sessions
      .filter(session => refresh.has(session.id))
      .map(session => session.id),
  );
  refresh.invalidate();
  return retry;
}
