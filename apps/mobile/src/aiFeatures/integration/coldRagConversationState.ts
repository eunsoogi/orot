import type {
  EvidenceBatch,
  MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import type { JsonObject } from '@orot/model-runtime';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { createResearchInputTracker } from './researchInputTracker';
import type { conversationExternalEvidence } from './conversationExternalEvidence';
import { captureConversationSources } from './captureConversationSources';

/** Bump when the allowlisted task/tool factory semantics change; no stored functions or grants. */
export const COLD_RAG_FACTORY_VERSION = 'rag-cold-v1';

/** Capture current local provenance before storage's epoch/claim fence, without external dispatch. */
export async function captureColdRagConversationState(input: {
  registry: LocalEvidenceReferenceRegistry;
  tracker: ReturnType<typeof createResearchInputTracker>;
  external: ReturnType<typeof conversationExternalEvidence>;
  sessionId: string;
  operationRunId: string;
  /** IDs must come from this request's protected tool-event/journal rows, not model text. */
  knownCallIds: readonly string[];
  batches: readonly EvidenceBatch[];
  options: MultiAgentWorkflowOptions<unknown>;
  researchPaging?: import('./researchPagingState').ResearchPagingSnapshot;
  signal: AbortSignal;
}): Promise<JsonObject> {
  if (input.options.photoInput)
    throw new Error('Cold photo reconstruction is unsupported.');
  const registry = input.registry.snapshot();
  const captured = await captureConversationSources(
    registry.entries.map(value => value.alias),
    input.registry,
    input.signal,
  );
  if (input.signal.aborted)
    throw new Error('Cold provenance capture cancelled.');
  const scope = input.registry.toolReferences.snapshotScope(
    { sessionId: input.sessionId, operationRunId: input.operationRunId },
    input.knownCallIds,
    reference => input.registry.resolve(reference),
  );
  return JSON.parse(
    JSON.stringify({
      factoryVersion: COLD_RAG_FACTORY_VERSION,
      invocation: {
        request: input.options.request,
        context: input.options.context ?? null,
        initialEvidence: input.options.initialEvidence,
        initialSearch: input.options.initialSearch ?? null,
        task: {
          taskType: input.options.task.taskType,
          taskVersion: input.options.task.taskVersion,
        },
        photo: null,
      },
      ...(input.researchPaging ? { researchPaging: input.researchPaging } : {}),
      registry,
      sources: captured.sources,
      research: input.tracker.snapshot(),
      scope,
      external: input.external.snapshot(),
      evidenceBatches: input.batches,
    }),
  );
}
