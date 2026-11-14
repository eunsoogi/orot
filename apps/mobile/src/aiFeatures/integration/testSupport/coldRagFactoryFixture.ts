import { budgetAfterPublicSearch } from '../defaultPublicSearch';
import type { ColdConversationSearch } from '../coldConversationSearch';
import { localData } from '../featureServiceFixtures';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createResearchInputTracker } from '../researchInputTracker';
import { conversationExternalEvidence } from '../conversationExternalEvidence';
import { createConversationToolBundle } from '../conversationToolBundle';
import { executionOptions } from '../featureServiceExecution';
import { captureColdRagConversationState } from '../coldRagConversationState';
import {
  continuationInput,
  continuationManifest,
} from '../../../storage/conversationWorkflowContinuationIdentity';
import type { ConversationColdResumeDescriptor } from '../../../storage/conversationColdResumeDescriptor';
import { ragConversationTask } from '../../../ragConversation/task';
import { runRagConversationTurn } from '../../../ragConversation/service';

export async function coldRagFactoryFixture(
  eager?: ColdConversationSearch,
  prepareData?: (data: import('../localData').AiFeatureLocalData) => void,
) {
  const f = publicEvidenceFixture();
  const local = localData([]);
  prepareData?.(local.data);
  const registry = new LocalEvidenceReferenceRegistry();
  const dependencies = {
    consent: f.consent,
    queryConsent: { authorize: jest.fn(async () => 'authorized' as const) },
    externalEvidence: {
      search: jest.fn(async () => ({ status: 'empty' as const })),
    },
    loadLocalData: async () => local.data,
    selectedAi: jest.fn(async () => f.selected),
    registry,
    ragRunner: runRagConversationTurn,
  };
  const tracker = createResearchInputTracker(registry, local.data, 'session');
  const external = conversationExternalEvidence({
    selected: f.selected,
    consent: dependencies.consent,
    queryConsent: dependencies.queryConsent,
    externalEvidence: dependencies.externalEvidence,
    loadLocalData: dependencies.loadLocalData,
    researchInputs: tracker,
  });
  const bundle = createConversationToolBundle({
    data: local.data,
    registry,
    researchInputs: tracker,
    external,
    publicSearchSucceeded: !eager || eager.status === 'success',
  });
  const options = {
    ...executionOptions({
      selected: f.selected,
      operationRunId: 'run',
      consent: dependencies.consent,
      registry,
      tools: bundle.tools,
      external,
      consentPurpose: 'record_conversation',
    }),
    request: 'Synthetic greeting',
    context: { previousConversation: [] },
    initialEvidence: { items: [], coverage: [], conflicts: [] },
    task: ragConversationTask,
    initialSearch: {
      toolId: external.publicWebTool!.id,
      input: { topics: ['sleep'] },
    },
  };
  if (eager) {
    Object.assign(options, { initialSearch: undefined });
    options.execution.budget = {
      ...options.execution.budget,
      maxModelCalls: budgetAfterPublicSearch(
        options.execution.budget,
        eager,
        eager.charged,
      ).maxModelCalls,
    };
  }
  const descriptor: ConversationColdResumeDescriptor = {
    version: 1,
    sourceEpoch: 0,
    attempt: 0,
    checkpointId: 'checkpoint',
    manifest: continuationManifest(
      { requestId: 'request', sessionId: 'session', sessionVersion: 0 },
      'conversation-resume:request',
      options,
    ),
    request: options.request,
    submittedInput: null,
    exactInput: continuationInput(options),
    reconstruction: await captureColdRagConversationState({
      registry,
      tracker,
      external,
      sessionId: 'session',
      operationRunId: 'run',
      knownCallIds: [],
      batches: [options.initialEvidence],
      options,
      signal: f.controller.signal,
    }),
  };
  if (eager)
    descriptor.reconstruction = {
      ...descriptor.reconstruction,
      publicSearch: { ...eager },
    };
  return {
    ...f,
    local,
    dependencies,
    descriptor,
    options,
    bundle,
    registry,
    tracker,
    external,
  };
}
