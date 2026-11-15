import type { ConversationContinuationCapture } from './conversationContinuationCapture';
import {
  isSafeConversationResumePhase,
  type ConversationResumeBoundary,
} from './conversationWorkflowResumeBoundary';
import {
  SqliteCheckpointSaver,
  type MultiAgentCheckpointState,
  type MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import {
  createLangGraphCheckpointStorage,
  type SqlDatabase,
  type SqlExecutor,
} from '@orot/storage';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import type { ConversationWorkflowContinuation } from '../ragConversation/conversationWorkflowContinuation';
import { createConversationArtifactStorage } from './conversationArtifactStorage';
import {
  createConversationWorkflowResumeStorage,
  type ConversationResumeManifest,
} from './conversationWorkflowResumeStorage';
import { createConversationOperationJournal } from './conversationOperationJournal';
import { setupConversationWorkflowCheckpointGuards } from './conversationWorkflowCheckpointGuards';
import {
  continuationInput,
  continuationManifest,
  type ConversationContinuationIdentity,
} from './conversationWorkflowContinuationIdentity';

/** Protected storage only; cached invocation/evidence belongs to this live owner, never reconstructed after restart. */
export async function createConversationWorkflowContinuationStore(
  database: SqlDatabase,
  identity: ConversationContinuationIdentity,
  capture?: ConversationContinuationCapture,
): Promise<ConversationWorkflowContinuation['persisted']> {
  const artifacts = createConversationArtifactStorage(database);
  await artifacts.currentGeneration();
  const checkpointStorage = createLangGraphCheckpointStorage(database);
  await checkpointStorage.ensureSchema();
  const checkpointer = new SqliteCheckpointSaver(checkpointStorage);
  const threadId = `conversation-resume:${identity.requestId}`;
  const config = { configurable: { thread_id: threadId } };
  let original: MultiAgentWorkflowOptions<unknown> | undefined;
  let snapshotEvidence:
    (() => readonly import('@orot/agent-runtime').EvidenceBatch[]) | undefined;
  let exactInput = '';
  let submittedInput: unknown;
  let manifest: ConversationResumeManifest | undefined;
  let saved: MultiAgentCheckpointState | undefined;
  let checkpointId = '';
  let checkpointBytes = '';
  let attempt = 0;
  let processing = false;
  let operationJournal:
    import('@orot/agent-runtime').WorkflowOperationJournal | undefined;
  let claimSignal: AbortSignal | undefined;
  // Revalidate outside SQL: adapters can read the DB or prompt for consent.
  async function validate(
    sql: SqlExecutor,
    m: ConversationResumeManifest,
    id: string,
  ) {
    if (
      !original ||
      !saved ||
      !claimSignal ||
      claimSignal.aborted ||
      id !== checkpointId ||
      continuationInput(original) !== exactInput
    )
      return false;
    const request = (
      await sql.execute(
        'SELECT question, input_json FROM conversation_requests WHERE id = ? AND session_id = ? AND session_version = ?',
        [m.requestId, m.sessionId, m.sessionVersion],
      )
    ).rows[0];
    if (
      !request ||
      request.question !== original.request ||
      request.input_json !== submittedInput
    )
      return false;
    const latestRow = (
      await sql.execute(
        `SELECT checkpoint_id FROM langgraph_checkpoints
      WHERE thread_id = ? AND checkpoint_ns = '' ORDER BY checkpoint_id DESC LIMIT 1`,
        [threadId],
      )
    ).rows[0];
    return latestRow?.checkpoint_id === id;
  }
  const store = createConversationWorkflowResumeStorage(
    database,
    async () => {},
    validate,
  );
  async function latest() {
    const tuple = await checkpointer.getTuple(config);
    if (!tuple) throw new Error('Durable workflow checkpoint unavailable.');
    return tuple;
  }
  async function exclusive(operation: () => Promise<void>) {
    if (processing) throw new Error('Continuation transition already running.');
    processing = true;
    try {
      await operation();
    } finally {
      processing = false;
    }
  }
  return {
    checkpointer,
    threadId,
    get operationJournal() {
      return operationJournal;
    },
    async initialize(options, signal, snapshot) {
      if (original) throw new Error('Continuation already initialized.');
      // The request must already exist; initialization never manufactures a new turn.
      const input = (
        await database.execute(
          'SELECT question, input_json FROM conversation_requests WHERE id = ? AND session_id = ? AND session_version = ?',
          [identity.requestId, identity.sessionId, identity.sessionVersion],
        )
      ).rows[0];
      if (!input || input.question !== options.request)
        throw new Error('Original conversation input changed.');
      submittedInput = input.input_json;
      original = options;
      snapshotEvidence = snapshot;
      exactInput = continuationInput(options);
      manifest = continuationManifest(identity, threadId, options);
      await store.register(manifest);
      await setupConversationWorkflowCheckpointGuards(database);
      if (!signal || signal.aborted)
        throw new Error('Continuation signal unavailable.');
      operationJournal = await createConversationOperationJournal(
        database,
        { ...identity, operationRunId: options.execution.operationRunId },
        async operation => {
          if (signal.aborted || continuationInput(options) !== exactInput)
            return false;
          const valid =
            operation.evidenceReferences.length === 0 ||
            (await options.revalidateEvidence(
              operation.evidenceReferences,
              signal,
            ));
          return valid && !signal.aborted;
        },
      );
    },
    async paused(checkpoint) {
      await exclusive(async () => {
        if (
          !original ||
          !manifest ||
          checkpoint.pendingOperation ||
          checkpoint.terminal !== false ||
          checkpoint.operationRunId !== original.execution.operationRunId ||
          checkpoint.providerId !== original.execution.providerId ||
          checkpoint.modelId !== original.execution.modelId ||
          !isSafeConversationResumePhase(checkpoint)
        )
          throw new Error('Workflow has no safe continuation boundary.');
        const tuple = await latest();
        const state = tuple.checkpoint.channel_values;
        // Compare every returned domain field to the actually persisted graph state.
        if (
          Object.entries(checkpoint).some(
            ([key, value]) =>
              stableJson(state[key] ?? null) !== stableJson(value ?? null),
          )
        )
          throw new Error('Paused result does not match durable checkpoint.');
        saved = checkpoint;
        checkpointId = tuple.checkpoint.id;
        checkpointBytes = stableJson(tuple.checkpoint);
        await store.saveBoundary(
          manifest,
          {
            checkpointId,
            phase: checkpoint.phase as ConversationResumeBoundary['phase'],
            awaitingAuthorization: checkpoint.awaitingAuthorization,
            pendingOperation: false,
            terminal: false,
          },
          attempt,
        );
        await capture?.({
          options: original,
          checkpoint,
          checkpointId,
          attempt,
          submittedInput,
          evidenceBatches: snapshotEvidence?.(),
        });
        await artifacts.interruptRequest(
          identity.requestId,
          identity.sessionId,
          identity.sessionVersion,
          'interrupted',
          checkpoint.awaitingAuthorization ? 'decision-required' : 'expired',
        );
      });
    },
    async claim(signal?: AbortSignal) {
      await exclusive(async () => {
        if (!signal || signal.aborted)
          throw new Error('Continuation cancelled.');
        claimSignal = signal;
        if (
          !original ||
          !manifest ||
          !saved ||
          continuationInput(original) !== exactInput
        )
          throw new Error('Original continuation owner unavailable.');
        const tuple = await latest();
        if (
          tuple.checkpoint.id !== checkpointId ||
          stableJson(tuple.checkpoint) !== checkpointBytes
        )
          throw new Error('Workflow checkpoint changed.');
        // This is source freshness, not reusable permission. Runtime must authorize
        // the exact outgoing payload again after this storage transition.
        if (
          saved.evidenceReferences.length > 0 &&
          !(await original.revalidateEvidence(saved.evidenceReferences, signal))
        )
          throw new Error('Continuation sources changed.');
        if (signal.aborted) throw new Error('Continuation cancelled.');
        const claim = await store.claim(manifest, checkpointId, async sql => {
          if (signal.aborted) throw new Error('Continuation cancelled.');
          await sql.execute(
            `UPDATE conversation_requests SET status = 'active', interruption_reason = NULL
            WHERE id = ? AND session_id = ? AND session_version = ? AND status = 'interrupted'`,
            [identity.requestId, identity.sessionId, identity.sessionVersion],
          );
        });
        attempt = claim.attempt;
      });
    },
  };
}

export { openConversationWorkflowContinuationStore } from './openConversationWorkflowContinuationStore';
