import type { EvidenceBatch } from './evidenceContracts';
import { appendNativeToolResultMessage } from './nativeTools';
import {
  canceled,
  completeState,
  finishToolEvent,
  stop,
  type RuntimeContext,
} from './runtimeContext';

/** An in-memory nomination is neither a committed effect nor recoverable evidence. */
export function finishLocalSidecar<TResult>(
  context: RuntimeContext<TResult>,
  result: EvidenceBatch & { readonly sidecarStatus?: 'staged' | 'ignored' },
) {
  if (context.signal.aborted) {
    canceled(context);
    return completeState();
  }
  const { sidecarStatus: status, items, coverage, conflicts } = result;
  if (
    items.length ||
    coverage.length ||
    conflicts.length ||
    (status !== 'staged' && status !== 'ignored') ||
    !appendNativeToolResultMessage(context.nativeToolMessages, context.pendingNativeToolCallId, {
      status,
    })
  ) {
    stop(context, 'The local sidecar could not report its exact state.', 'invalid_output');
    return completeState();
  }
  finishToolEvent(context, 'completed', []);
  context.researchInput = undefined;
  context.pendingNativeToolCallId = undefined;
  return { phase: 'revised_response' as const, pendingOperation: undefined };
}
