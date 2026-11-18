import { providerDiagnostic } from '../providers/diagnostics';

type Boundary =
  | 'stop_js'
  | 'stop_abort'
  | 'stop_settlement'
  | 'conversation_photo_flush'
  | 'conversation_preview_flush'
  | 'conversation_activity_flush'
  | 'conversation_stop_fence'
  | 'conversation_lifetime_settle'
  | 'conversation_final_history_validation'
  | 'conversation_retention_capture'
  | 'conversation_save';

/** Fixed opt-in boundaries contain no identifiers, content, values or exception text.
 * Native receipt timestamps measure observation gaps, not proof of remote cancellation. */
export function conversationBoundary(
  stage: Boundary,
  outcome: 'started' | 'completed' | 'failed',
) {
  try {
    providerDiagnostic('rag', stage, outcome);
  } catch {
    // Optional diagnostics must never delay cancellation or replace a storage outcome.
  }
}

/** Preserve the original await, value and failure; completed means returned, not committed or remotely cancelled. */
export async function observeConversationFinalization<T>(
  stage: Boundary,
  work: () => T | Promise<T>,
): Promise<T> {
  conversationBoundary(stage, 'started');
  try {
    const value = await work();
    conversationBoundary(stage, 'completed');
    return value;
  } catch (error) {
    conversationBoundary(stage, 'failed');
    throw error;
  }
}

/** Group only the existing ordered cleanup operations; do not parallelize protected writes. */
export const conversationFinalization = {
  async presentation(
    values: {
      photoInput?: { settleUnsent?: () => Promise<unknown> };
      preview?: { flush: () => Promise<unknown> };
      activity?: {
        finish: (status: 'cancelled' | 'interrupted' | 'failed') => void;
        flush: () => Promise<unknown>;
      };
    },
    status: () => 'cancelled' | 'interrupted' | 'failed',
  ) {
    await observeConversationFinalization('conversation_photo_flush', () =>
      values.photoInput?.settleUnsent?.().catch(() => {}),
    );
    values.activity?.finish(status());
    await observeConversationFinalization('conversation_preview_flush', () =>
      values.preview?.flush(),
    );
    await observeConversationFinalization('conversation_activity_flush', () =>
      values.activity?.flush(),
    );
  },
  lifetime(
    lifetime: {
      settle: (id: number, controller: AbortController) => Promise<void>;
    },
    id: number,
    controller: AbortController,
  ) {
    return observeConversationFinalization('conversation_lifetime_settle', () =>
      lifetime.settle(id, controller),
    );
  },
};
