import {
  coldSelectedModelIdentity,
  createColdPromptDialogueGuard,
} from './coldPromptDialogue';
import { restoreConversationRequestBudget } from './restoreConversationRequestBudget';
import { coldArtifactPaging } from './artifactPagingSnapshot';
import { restoreColdConversationActions } from './restoreColdConversationActions';
import { readColdPhotoBinding } from './coldPhotoBinding';
import { restoreColdPhotoExecution } from './restoreColdPhotoExecution';
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
import type { GroundedRagAnswer } from '../../ragConversation/task';
import { restoreConversationTask } from '../../ragConversation/conversationTaskVersions';
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
import {
  assertColdRagFactoryState,
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
  if (signal.aborted || saved.factoryVersion !== COLD_RAG_FACTORY_VERSION)
    throw new Error('Unsupported cold conversation factory.');
  assertColdRagFactoryState(saved);
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
  const task = restoreConversationTask(original.task, d.exactInput);
  if (!task || original.request !== d.request)
    throw new Error('Unsupported cold task or photo.');
  const photo = readColdPhotoBinding(d, input.observer?.confirmPhotoResume);
  const selected = await deps.selectedAi();
  const expectedSelection = coldSelectedModelIdentity(selected);
  const data = await deps.loadLocalData();
  const dialogueCurrent = await createColdPromptDialogueGuard(
    saved.completion,
    data,
    {
      id: d.manifest.sessionId,
      version: d.manifest.sessionVersion,
    },
  );
  const registry = await restoreColdConversationRegistry({
    snapshot: saved.registry as unknown as EvidenceRegistrySnapshot,
    sources: saved.sources as unknown as readonly ConversationArtifactSource[],
    ...(photo ? { photo } : {}),
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
    artifactPaging: coldArtifactPaging(d, input.observer),
    publicSearchSucceeded: !publicSearch || publicSearch.status === 'success',
    researchPaging:
      'researchPaging' in saved
        ? {
            snapshot: saved.researchPaging,
            operationRunId: scope.operationRunId,
          }
        : undefined,
  });
  const base = executionOptions({
    selected,
    operationRunId: d.manifest.operationRunId,
    consent: deps.consent,
    registry,
    tools: bundle.tools,
    external,
    consentPurpose: 'record_conversation',
  });
  const execution = photo
    ? await restoreColdPhotoExecution({
        base,
        selected,
        data,
        registry,
        signal,
        ...photo,
      })
    : base;
  const aliases = registry.snapshot().entries.map(value => value.alias);
  const historyIsCurrent = async () =>
    !signal.aborted &&
    ((await dialogueCurrent?.(signal)) ?? true) &&
    (!aliases.length || (await registry.revalidateEvidence(aliases, signal)));
  let options: MultiAgentWorkflowOptions<GroundedRagAnswer> = {
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
    actions: await restoreColdConversationActions({
      descriptor: d,
      observer: input.observer,
      data,
      registry,
      signal,
      dialogueCurrent,
    }),
    request: original.request,
    context: original.context as JsonObject,
    initialEvidence: original.initialEvidence as EvidenceBatch,
    ...(original.initialSearch
      ? { initialSearch: original.initialSearch }
      : {}),
    task,
    revalidateEvidence: (references, current) =>
      revalidateWithLocalDeletionGuard(
        references,
        current,
        execution.revalidateEvidence,
        reference => registry.resolve(reference),
        deps.deletionRevalidationStorage,
      ),
  };
  options = restoreConversationRequestBudget(options, d.exactInput);
  await validateColdRagBatches(
    saved.evidenceBatches as unknown as EvidenceBatch[],
    options,
    external,
    signal,
    registry,
  );
  if (
    continuationInput(options) !== d.exactInput ||
    !(await historyIsCurrent())
  )
    throw new Error('Cold invocation no longer matches current policy.');
  return {
    options,
    submittedInput: photo?.submitted,
    publicSearch,
    registry,
    bundle,
    historyIsCurrent,
    dialogueCurrent,
    async validateSelection(current: AbortSignal) {
      if (
        current.aborted ||
        coldSelectedModelIdentity(await deps.selectedAi()) !==
          expectedSelection ||
        current.aborted ||
        !(await historyIsCurrent())
      )
        throw new Error('Cold selection or original sources changed.');
    },
    capture: async (
      batches: readonly EvidenceBatch[],
    ): Promise<JsonObject> => ({
      ...(await captureColdRagConversationState({
        registry,
        tracker,
        external,
        ...scope,
        knownCallIds: await input.readKnownCallIds(),
        batches,
        researchPaging: bundle.generated.researchPagingSnapshot?.(
          scope.operationRunId,
        ),
        artifactPaging: bundle.generated.artifactPagingSnapshot?.(),
        options,
        signal,
      })),
      ...(publicSearch ? { publicSearch: { ...publicSearch } } : {}),
    }),
  };
}
