import type {
  ConversationSessionOptions,
  ConversationSnapshot,
} from './conversationSessionTypes';
import type { createConversationSessionAttachment } from './conversationSessionAttachment';

/** Hydration leaves the active draft selected and deduplicates attached sessions. */
export function createConversationHistoryLoader(input: {
  options: ConversationSessionOptions;
  snapshot: () => ConversationSnapshot;
  attach: ReturnType<typeof createConversationSessionAttachment>;
  lifecycle: () => number;
  disposed: () => boolean;
}) {
  let loading: { promise: Promise<void>; lifecycle: number } | null = null;
  return () => {
    const { options } = input;
    if (!options.listSessions || !options.retention || input.disposed())
      return Promise.resolve();
    const started = input.lifecycle();
    if (loading?.lifecycle === started) return loading.promise;
    const load = async () => {
      let cursor:
        { readonly updatedAt: string; readonly id: string } | undefined;
      do {
        const page = await options.listSessions!(cursor);
        if (input.disposed() || started !== input.lifecycle()) return;
        for (const item of page.items) {
          if (input.disposed() || started !== input.lifecycle()) return;
          if (
            input
              .snapshot()
              .sessions.some(
                session =>
                  options.retention!.activeIdentity(session.id) === item.id,
              )
          )
            continue;
          await input.attach(item.id, item.version, item.updatedAt, false);
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
    };
    const pending = load();
    loading = { promise: pending, lifecycle: started };
    pending
      .finally(() => {
        if (loading?.promise === pending) loading = null;
      })
      .catch(() => {});
    return pending;
  };
}
