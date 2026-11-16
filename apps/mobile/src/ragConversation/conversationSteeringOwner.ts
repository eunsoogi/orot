import type { WorkflowOperationJournal } from '@orot/agent-runtime';
import type { ConversationSession } from './conversationSessionTypes';
type Store = NonNullable<WorkflowOperationJournal['steering']>;

/** UI ownership is distinct from durable request identity. Late receipts cannot alter a newer turn. */
export function createConversationSteeringOwner(
  find: (id: number) => ConversationSession,
  update: (id: number, change: Partial<ConversationSession>) => void,
) {
  const entries = new Map<
    number,
    {
      store: Store;
      current: () => boolean;
      release?: () => void;
      submitting: boolean;
    }
  >();
  let sequence = 0;
  const prefix = Date.now().toString(36);
  const clear = (id: number) => {
    entries.get(id)?.release?.();
    entries.delete(id);
    update(id, {
      steeringInstructions: [],
      steeringDeliveryMode: undefined,
      steeringAvailable: false,
      steeringSubmitting: false,
      steeringError: false,
    });
  };
  return {
    clear,
    dispose: () => {
      for (const id of entries.keys()) clear(id);
    },
    bind(id: number, store: Store, current: () => boolean) {
      if (!current()) return;
      entries.get(id)?.release?.();
      const entry = {
        store,
        current,
        release: undefined as (() => void) | undefined,
        submitting: false,
      };
      entries.set(id, entry);
      const refresh = async () => {
        const rows = await store.list();
        if (entries.get(id) === entry && current())
          update(id, { steeringInstructions: rows });
      };
      entry.release = store.subscribe?.(refresh);
      if (current())
        update(id, { steeringAvailable: true, steeringInstructions: [] });
      refresh().catch(() => {});
    },
    async submit(id: number) {
      const entry = entries.get(id);
      const text = find(id)?.draft.trim();
      if (!entry || !entry.current() || entry.submitting || !text) return;
      entry.submitting = true;
      update(id, { steeringSubmitting: true, steeringError: false });
      try {
        const accepted = await entry.store.enqueue(
          `steering-${prefix}-${++sequence}`,
          text,
        );
        if (
          accepted &&
          entries.get(id) === entry &&
          entry.current() &&
          find(id)?.draft.trim() === text
        )
          update(id, { draft: '' });
        if (!accepted && entries.get(id) === entry && entry.current())
          update(id, { steeringError: true });
      } catch {
        if (entries.get(id) === entry && entry.current())
          update(id, { steeringError: true });
      } finally {
        entry.submitting = false;
        if (entries.get(id) === entry && entry.current())
          update(id, { steeringSubmitting: false });
      }
    },
    finish(id: number, current: () => boolean, resumable = true) {
      const entry = entries.get(id);
      if (!entry || entry.current !== current) return;
      entry.release?.();
      entries.delete(id);
      const session = find(id);
      if (session)
        update(id, {
          steeringAvailable: false,
          steeringSubmitting: false,
          steeringInstructions: resumable
            ? session.steeringInstructions
            : session.steeringInstructions?.map(row =>
                row.status === 'applied' || row.status === 'delivery_pending'
                  ? row
                  : { ...row, status: 'not_applied' },
              ),
        });
    },
  };
}
