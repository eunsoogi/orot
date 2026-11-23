import type { WorkflowOperationJournal } from '@orot/agent-runtime';
import type { ConversationSession } from './conversationSessionTypes';
import {
  beginSteeringLatency,
  markSteeringLatency,
  retireSteeringLatency,
  steeringLatencyTracked,
} from './steeringLatencyDiagnostic';
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
      submissionId?: string;
      responseId?: number;
    }
  >();
  let sequence = 0;
  const prefix = Date.now().toString(36);
  const dropActive = (id: number) => {
    retireSteeringLatency(entries.get(id)?.submissionId);
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
  const clear = (id: number) => {
    dropActive(id);
    update(id, {
      messages: find(id)?.messages.map(message => ({
        ...message,
        steeringInstructions: undefined,
      })),
    });
  };
  return {
    clear,
    dropActive,
    dispose: () => {
      for (const id of entries.keys()) clear(id);
    },
    bind(id: number, store: Store, current: () => boolean) {
      if (!current()) return;
      retireSteeringLatency(entries.get(id)?.submissionId);
      entries.get(id)?.release?.();
      const entry = {
        store,
        current,
        release: undefined as (() => void) | undefined,
        submitting: false,
        submissionId: undefined as string | undefined,
        responseId: find(id)?.pendingMessage?.id,
      };
      entries.set(id, entry);
      const refresh = async () => {
        const rows = await store.list();
        if (entries.get(id) === entry && current()) {
          const own =
            entry.submissionId && steeringLatencyTracked(entry.submissionId)
              ? rows.find(row => row.id === entry.submissionId)
              : undefined;
          if (own) {
            markSteeringLatency(own.id, 'steering_row_available');
            if (
              own.status === 'applied' &&
              'readAt' in own &&
              typeof own.readAt === 'string'
            )
              markSteeringLatency(own.id, 'steering_applied_observed');
            if (own.status === 'not_applied') retireSteeringLatency(own.id);
          }
          update(id, {
            steeringInstructions: rows.map(row =>
              row.id === entry.submissionId
                ? { ...row, submittedHere: true as const }
                : row,
            ),
          });
        }
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
      retireSteeringLatency(entry.submissionId);
      const submissionId = `steering-${prefix}-${++sequence}`;
      entry.submissionId = submissionId;
      beginSteeringLatency(
        submissionId,
        () => entries.get(id) === entry && entry.current(),
      );
      update(id, { steeringSubmitting: true, steeringError: false });
      try {
        const accepted = await entry.store.enqueue(submissionId, text);
        if (accepted)
          markSteeringLatency(submissionId, 'steering_enqueue_resolved');
        else retireSteeringLatency(submissionId);
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
        retireSteeringLatency(submissionId);
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
      retireSteeringLatency(entry.submissionId);
      if (session) {
        const instructions = resumable
          ? session.steeringInstructions
          : session.steeringInstructions?.map(row =>
              row.status === 'applied' || row.status === 'delivery_pending'
                ? row
                : { ...row, status: 'not_applied' as const },
            );
        const target = session.messages.find(
          message =>
            message.role === 'assistant' && message.id === entry.responseId,
        );
        update(id, {
          steeringAvailable: false,
          steeringSubmitting: false,
          steeringInstructions: target ? [] : instructions,
          messages: session.messages.map(message =>
            message === target
              ? { ...message, steeringInstructions: instructions }
              : message,
          ),
        });
      }
    },
  };
}
