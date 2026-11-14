import {
  type EvidenceBatch,
  createMultiAgentPauseController,
  runMultiAgentWorkflow,
  type MultiAgentInvocation,
  type MultiAgentRunResult,
  type MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import { conversationWorkflowEvidenceCache } from '../aiFeatures/integration/conversationWorkflowEvidenceCache';

/** UI binding is explicit and lifetime-scoped. A process restart cannot silently recreate this owner. */
export interface ConversationWorkflowContinuation {
  readonly validateSelection?: (signal: AbortSignal) => Promise<void>;
  readonly bindPause: (requestPause: () => void) => void;
  readonly waitForContinue: (
    reason?: 'expired' | 'decision-required',
  ) => Promise<boolean>;
  readonly persisted: {
    readonly checkpointer: NonNullable<
      MultiAgentWorkflowOptions['checkpointer']
    >;
    readonly threadId: string;
    readonly operationJournal?: import('@orot/agent-runtime').WorkflowOperationJournal;
    initialize(
      options: MultiAgentWorkflowOptions<unknown>,
      signal: AbortSignal,
      snapshotEvidence?: () => readonly EvidenceBatch[],
    ): Promise<void>;
    paused(
      checkpoint: Extract<
        MultiAgentRunResult<unknown>,
        { status: 'paused' }
      >['checkpoint'],
    ): Promise<void>;
    claim(signal: AbortSignal): Promise<void>;
  };
}

/** Invoke the same durable LangGraph thread; never call the original send pipeline or replay tool events. */
export async function runContinuableConversationWorkflow<T>(
  options: MultiAgentWorkflowOptions<T>,
  invocation: MultiAgentInvocation,
  continuation?: ConversationWorkflowContinuation,
): Promise<MultiAgentRunResult<T>> {
  if (!continuation) return runMultiAgentWorkflow(options, invocation);
  const signal = invocation.signal ?? new AbortController().signal;
  const original = conversationWorkflowEvidenceCache(options);
  await continuation.persisted.initialize(
    options as MultiAgentWorkflowOptions<unknown>,
    signal,
    original.snapshotEvidence,
  );
  const durable = {
    ...original,
    checkpointer: continuation.persisted.checkpointer,
    operationJournal: continuation.persisted.operationJournal,
  };
  while (!signal.aborted) {
    const pause = createMultiAgentPauseController();
    continuation.bindPause(() => pause.requestPause());
    const result = await runMultiAgentWorkflow(durable, {
      ...invocation,
      signal,
      pause,
      config: { configurable: { thread_id: continuation.persisted.threadId } },
    });
    if (result.status !== 'paused') return result;
    await continuation.persisted.paused(result.checkpoint);
    if (
      signal.aborted ||
      !(await continuation.waitForContinue(
        result.checkpoint.awaitingAuthorization
          ? 'decision-required'
          : 'expired',
      ))
    )
      return result;
    // Atomic ownership and live session/source/approval fences precede every resumed dispatch.
    await continuation.validateSelection?.(signal);
    await continuation.persisted.claim(signal);
    await continuation.validateSelection?.(signal);
  }
  // A hard OS cancellation must follow the normal non-resumable abort path, not pretend to be a pause.
  return runMultiAgentWorkflow(durable, {
    ...invocation,
    config: { configurable: { thread_id: continuation.persisted.threadId } },
  });
}
