import { readColdConversationSearch } from './coldConversationSearch';
import { budgetAfterPublicSearch } from './defaultPublicSearch';
import { validateColdRagBatches } from './validateColdRagBatches';
import type {
  EvidenceBatch,
  MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import type { JsonObject } from '@orot/model-runtime';
import type { ConversationColdResumeDescriptor } from '../../storage/conversationColdResumeDescriptor';
import { continuationInput } from '../../storage/conversationWorkflowContinuationIdentity';
import {
  ragConversationTask,
  type GroundedRagAnswer,
} from '../../ragConversation/task';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { RagConversationServiceDependencies } from './ragConversationServiceDependencies';
import { restoreColdConversationRegistry } from './restoreColdConversationRegistry';
import type { EvidenceRegistrySnapshot } from './evidenceRegistrySnapshot';
import type { ConversationArtifactSource } from '../../ragConversation/conversationArtifactSources';
import type { ResearchInputTrackerSnapshot } from './researchInputTrackerSnapshot';
import type { ToolReferenceScopeSnapshot } from './toolReferenceScopeSnapshot';
import type { SelectedExternalEvidenceSnapshot } from './selectedExternalEvidence';
import { createResearchInputTracker } from './researchInputTracker';
import { conversationExternalEvidence } from './conversationExternalEvidence';
import { createConversationToolBundle } from './conversationToolBundle';
import { executionOptions } from './featureServiceExecution';
import { guardHistory } from './conversationHistoryProviderGuard';
import { revalidateWithLocalDeletionGuard } from './deletionAwareEvidence';
import { stableJson } from './evidenceUtils';
import {
  COLD_RAG_FACTORY_VERSION,
  captureColdRagConversationState,
} from './coldRagConversationState';

/** Reconstruct only the app-owned RAG task with fresh adapters. Never call send or initial retrieval. */
export async function restoreColdRagConversationFactory(input: {
  descriptor: ConversationColdResumeDescriptor;
  dependencies: RagConversationServiceDependencies;
  observer?: RagConversationObserver;
  signal: AbortSignal;
  readKnownCallIds(): Promise<readonly string[]>;
}) {
  const { descriptor: d, dependencies: deps, signal } = input;
  const saved = d.reconstruction;
  if (
    signal.aborted ||
    saved.factoryVersion !== COLD_RAG_FACTORY_VERSION ||
    d.submittedInput !== null
  )
    throw new Error('Unsupported cold conversation factory.');
  if (
    !saved.external ||
    typeof saved.external !== 'object' ||
    Array.isArray(saved.external) ||
    !saved.registry ||
    !saved.research ||
    !saved.scope ||
    !Array.isArray(saved.sources) ||
    !Array.isArray(saved.evidenceBatches)
  )
    throw new Error('Incomplete protected cold factory state.');
  // exactInput is an equality marker (including function slots), not a JSON serialization.
  const original = saved.invocation as unknown as {
    request: string;
    context: JsonObject;
    initialEvidence: EvidenceBatch;
    initialSearch: MultiAgentWorkflowOptions['initialSearch'];
    photo: null;
    task: { taskType: string; taskVersion: string };
  };
  if (!original || typeof original !== 'object' || !original.task)
    throw new Error('Cold invocation snapshot missing.');
  if (
    original.photo !== null ||
    original.task?.taskType !== ragConversationTask.taskType ||
    original.task?.taskVersion !== ragConversationTask.taskVersion ||
    original.request !== d.request
  )
    throw new Error('Unsupported cold task or photo.');
  const selected = await deps.selectedAi();
  const selection = (value: typeof selected) =>
    stableJson({
      selection: value.selection,
      provider: value.provider.id,
      model: value.modelId,
      recipient: value.recipient,
      remote: value.remoteProcessing,
    });
  const expectedSelection = selection(selected);
  const data = await deps.loadLocalData();
  const registry = await restoreColdConversationRegistry({
    snapshot: saved.registry as unknown as EvidenceRegistrySnapshot,
    sources: saved.sources as unknown as readonly ConversationArtifactSource[],
    data,
    signal,
  });
  const scope = {
    sessionId: d.manifest.sessionId,
    operationRunId: d.manifest.operationRunId,
  };
  const receipt = registry.toolReferences.restoreScope(
    saved.scope as unknown as ToolReferenceScopeSnapshot,
    scope,
    await input.readKnownCallIds(),
    reference => registry.resolve(reference),
  );
  const tracker = createResearchInputTracker(
    registry,
    data,
    d.manifest.sessionId,
    {
      snapshot: saved.research as unknown as ResearchInputTrackerSnapshot,
      scope: { operationRunId: scope.operationRunId, receipt },
    },
  );
  const external = conversationExternalEvidence({
    selected,
    consent: deps.consent,
    queryConsent: deps.queryConsent,
    externalEvidence: deps.externalEvidence,
    loadLocalData: deps.loadLocalData,
    observer: input.observer,
    researchInputs: tracker,
    restored: saved.external as unknown as SelectedExternalEvidenceSnapshot,
  });
  const publicSearch = readColdConversationSearch(saved);
  const bundle = createConversationToolBundle({
    data,
    registry,
    observer: input.observer,
    researchInputs: tracker,
    external,
    publicSearchSucceeded: !publicSearch || publicSearch.status === 'success',
  });
  const execution = executionOptions({
    selected,
    operationRunId: d.manifest.operationRunId,
    consent: deps.consent,
    registry,
    tools: bundle.tools,
    external,
    consentPurpose: 'record_conversation',
  });
  const aliases = registry.snapshot().entries.map(value => value.alias);
  const historyIsCurrent = async () =>
    !signal.aborted &&
    (!aliases.length || (await registry.revalidateEvidence(aliases, signal)));
  const options: MultiAgentWorkflowOptions<GroundedRagAnswer> = {
    ...guardHistory(execution, historyIsCurrent, true),
    ...(publicSearch
      ? {
          execution: {
            ...execution.execution,
            budget: budgetAfterPublicSearch(
              execution.execution.budget,
              publicSearch,
              publicSearch.charged,
            ),
          },
        }
      : {}),
    request: original.request,
    context: original.context as JsonObject,
    initialEvidence: original.initialEvidence as EvidenceBatch,
    ...(original.initialSearch
      ? { initialSearch: original.initialSearch }
      : {}),
    task: ragConversationTask,
    revalidateEvidence: (references, current) =>
      revalidateWithLocalDeletionGuard(
        references,
        current,
        execution.revalidateEvidence,
        reference => registry.resolve(reference),
      ),
  };
  await validateColdRagBatches(
    saved.evidenceBatches as unknown as EvidenceBatch[],
    options,
    external,
    signal,
  );
  // This equality also binds the current selected provider, scope, budget and task/tool contracts.
  if (
    continuationInput(options) !== d.exactInput ||
    !(await historyIsCurrent())
  )
    throw new Error(
      'Cold invocation no longer matches current application policy.',
    );
  return {
    options,
    publicSearch,
    registry,
    bundle,
    historyIsCurrent,
    async validateSelection(current: AbortSignal) {
      if (
        current.aborted ||
        selection(await deps.selectedAi()) !== expectedSelection ||
        current.aborted ||
        !(await historyIsCurrent())
      )
        throw new Error('Cold selection or original sources changed.');
    },
    capture: async (batches: readonly EvidenceBatch[]) => ({
      ...(await captureColdRagConversationState({
        registry,
        tracker,
        external,
        ...scope,
        knownCallIds: await input.readKnownCallIds(),
        batches,
        options,
        signal,
      })),
      ...(publicSearch ? { publicSearch: { ...publicSearch } } : {}),
    }),
  };
}
