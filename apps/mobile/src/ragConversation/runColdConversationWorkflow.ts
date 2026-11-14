import { interruptColdConversationAttempt } from '../storage/interruptColdConversationAttempt';
import {
  SqliteCheckpointSaver,
  isMultiAgentCheckpointResumable,
  runMultiAgentWorkflow,
  type EvidenceBatch,
  type MultiAgentCheckpointState,
  type MultiAgentInvocation,
  type MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import {
  createLangGraphCheckpointStorage,
  type SqlDatabase,
} from '@orot/storage';
import type { JsonObject } from '@orot/model-runtime';
import { conversationWorkflowEvidenceCache } from '../aiFeatures/integration/conversationWorkflowEvidenceCache';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import type { ConversationColdResumeDescriptor } from '../storage/conversationColdResumeDescriptor';
import { createConversationColdResumeStorage } from '../storage/conversationColdResumeStorage';
import { continuationInput } from '../storage/conversationWorkflowContinuationIdentity';
import { createConversationOperationJournal } from '../storage/conversationOperationJournal';
import { createConversationWorkflowResumeStorage } from '../storage/conversationWorkflowResumeStorage';
import { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import {
  isSafeConversationResumePhase,
  type ConversationResumeBoundary,
} from '../storage/conversationWorkflowResumeBoundary';
import { saveConversationColdBoundary } from '../storage/saveConversationColdBoundary';

/** A fresh app factory supplies live adapters, never a stored provider, grant, or original send callback.
 * This runner activates the existing request once and invokes only its original graph thread. */
export async function runColdConversationWorkflow<T>(input: {
  database: SqlDatabase;
  descriptor: ConversationColdResumeDescriptor;
  options: MultiAgentWorkflowOptions<T>;
  invocation: MultiAgentInvocation;
  validateSelection(signal: AbortSignal): Promise<void>;
  capture(batches: readonly EvidenceBatch[]): Promise<JsonObject>;
  onClaim?(): void;
}) {
  const { database, descriptor: d, options } = input;
  const signal = input.invocation.signal ?? new AbortController().signal;
  const store = createConversationColdResumeStorage(database);
  const checkpointStorage = createLangGraphCheckpointStorage(database);
  const checkpointer = new SqliteCheckpointSaver(checkpointStorage);
  const config = { configurable: { thread_id: d.manifest.threadId } };
  const tuple = await checkpointer.getTuple(config);
  const state = tuple?.checkpoint.channel_values as
    MultiAgentCheckpointState | undefined;
  if (
    signal.aborted ||
    !tuple ||
    tuple.checkpoint.id !== d.checkpointId ||
    !state ||
    state.terminal !== false ||
    state.pendingOperation ||
    !Array.isArray(state.evidenceReferences) ||
    !isSafeConversationResumePhase(state) ||
    continuationInput(options) !== d.exactInput ||
    options.request !== d.request ||
    options.execution.operationRunId !== d.manifest.operationRunId
  )
    throw new Error('Original cold workflow unavailable.');
  const cache = conversationWorkflowEvidenceCache(
    options,
    d.reconstruction.evidenceBatches as unknown as readonly EvidenceBatch[],
  );
  if (!Array.isArray(d.reconstruction.evidenceBatches))
    throw new Error('Protected evidence snapshot unavailable.');
  const operationJournal = await createConversationOperationJournal(
    database,
    { ...d.manifest },
    async operation =>
      !signal.aborted &&
      continuationInput(options) === d.exactInput &&
      (!operation.evidenceReferences.length ||
        (await options.revalidateEvidence(
          operation.evidenceReferences,
          signal,
        ))),
  );
  const durable = { ...cache, checkpointer, operationJournal };
  if (!isMultiAgentCheckpointResumable(state, durable))
    throw new Error('Cold checkpoint cannot resume under the current runtime.');
  const exactCheckpoint = stableJson(tuple.checkpoint);
  const validate = async () => {
    await input.validateSelection(signal);
    const current = await checkpointer.getTuple(config);
    return (
      !signal.aborted &&
      continuationInput(options) === d.exactInput &&
      stableJson(current?.checkpoint) === exactCheckpoint &&
      (!state.evidenceReferences.length ||
        (await options.revalidateEvidence(state.evidenceReferences, signal)))
    );
  };
  const claim = await store.claim(d, signal, validate);
  try {
    await input.validateSelection(signal);
    if (signal.aborted) throw new Error('Cold workflow cancelled.');
    input.onClaim?.();
    const result = await runMultiAgentWorkflow(durable, {
      ...input.invocation,
      signal,
      config,
    });
    if (result.status !== 'paused') return result;
    const latest = await checkpointer.getTuple(config);
    if (
      !latest ||
      Object.entries(result.checkpoint).some(
        ([key, value]) =>
          stableJson(latest.checkpoint.channel_values[key] ?? null) !==
          stableJson(value ?? null),
      )
    )
      throw new Error('Cold continuation checkpoint changed.');
    const resume = createConversationWorkflowResumeStorage(
      database,
      async () => {},
      async () => false,
    );
    await resume.saveBoundary(
      d.manifest,
      {
        checkpointId: latest.checkpoint.id,
        phase: result.checkpoint.phase as ConversationResumeBoundary['phase'],
        awaitingAuthorization: result.checkpoint.awaitingAuthorization,
        pendingOperation: false,
        terminal: false,
      },
      claim.attempt,
    );
    try {
      await saveConversationColdBoundary(database, d.manifest, async () => ({
        ...(await input.capture(cache.snapshotEvidence())),
        evidenceBatches:
          cache.snapshotEvidence() as unknown as JsonObject['evidenceBatches'],
      }))({
        options,
        checkpoint: result.checkpoint,
        checkpointId: latest.checkpoint.id,
        attempt: claim.attempt,
        submittedInput: d.submittedInput,
      });
    } catch (error) {
      // An unsupported new private state cannot leave an older descriptor reusable.
      await database.execute(
        'DELETE FROM conversation_cold_resumes WHERE request_id = ?',
        [d.manifest.requestId],
      );
      throw error;
    } finally {
      // Even capture failure must end the active request; it never means retry the external dispatch.
      await createConversationArtifactStorage(database).interruptRequest(
        d.manifest.requestId,
        d.manifest.sessionId,
        d.manifest.sessionVersion,
        'interrupted',
        result.checkpoint.awaitingAuthorization
          ? 'decision-required'
          : 'expired',
      );
    }
    return result;
  } catch (error) {
    await interruptColdConversationAttempt(database, d.manifest, claim.attempt);
    throw error;
  }
}
