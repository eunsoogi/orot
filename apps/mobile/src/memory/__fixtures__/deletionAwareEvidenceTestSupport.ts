import {
  providerSuccess,
  type LanguageModelProvider,
} from '@orot/model-runtime';
import {
  runMultiAgentWorkflow,
  type EvidenceBatch,
  type EvidenceReference,
  type MultiAgentCheckpointState,
  type MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import { withLocalDeletionAwareRevalidation } from '../deletionAwareEvidenceRevalidation';

type EvidenceRevalidator = (
  references: readonly EvidenceReference[],
  signal: AbortSignal,
) => Promise<boolean>;

function makeEvidence(reference: EvidenceReference): EvidenceBatch {
  return {
    items: [{ ...reference, content: 'Synthetic retained evidence.' }],
    coverage: [
      {
        sourceKind: reference.sourceKind,
        searchedSourceIds: [reference.sourceId],
        gaps: [],
        truncated: false,
        resultLimit: 5,
        returnedCount: 1,
      },
    ],
    conflicts: [],
  };
}

/** Supplies a deterministic saved-state resume without external providers or source content. */
export function createDeletionResume(
  reference: EvidenceReference,
  revalidate: EvidenceRevalidator,
) {
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: 'synthetic-provider',
    displayName: 'Synthetic provider',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: false,
    },
    generate: jest.fn(async () =>
      providerSuccess({
        text: JSON.stringify({
          type: 'result',
          value: { summary: 'Prepared.' },
          citations: [reference],
        }),
        toolCalls: [],
        finishReason: 'complete' as const,
      }),
    ),
  };
  const restoreEvidence = jest.fn(async () => makeEvidence(reference));
  const options: MultiAgentWorkflowOptions<{ summary: string }> = {
    execution: {
      operationRunId: 'delete-resume-run',
      providerId: provider.id,
      modelId: 'synthetic-model',
      recipient: 'synthetic-account',
      remoteProcessing: true,
      allowedScope: {
        sourceKinds: ['personal_record'],
        sourceIds: [reference.sourceId],
      },
      budget: {
        maxModelCalls: 3,
        maxToolCalls: 1,
        maxResearchCycles: 1,
        maxPayloadBytes: 32000,
        maxOutputTokens: 512,
        timeoutMs: 5000,
        maxEvidenceItems: 5,
      },
    },
    provider,
    request: 'Prepare synthetic visit questions.',
    task: {
      taskType: 'synthetic-visit-questions',
      taskVersion: '1',
      systemPrompt: 'Return an evidence-linked result.',
      resultSchema: {
        type: 'object',
        required: ['summary'],
        properties: { summary: { type: 'string' } },
        additionalProperties: false,
      },
      createMessages: () => [
        { role: 'user', content: 'Prepare the requested questions.' },
      ],
      validateResult: () => ({
        status: 'valid',
        value: { summary: 'Prepared.' },
      }),
    },
    initialEvidence: { items: [], coverage: [], conflicts: [] },
    tools: [],
    consent: { authorize: async () => 'authorized' },
    revalidateEvidence: withLocalDeletionAwareRevalidation(revalidate),
    restoreEvidence,
  };
  const resumeFrom: MultiAgentCheckpointState = {
    operationRunId: options.execution.operationRunId,
    providerId: options.execution.providerId,
    modelId: options.execution.modelId,
    allowedScope: options.execution.allowedScope,
    budget: options.execution.budget,
    phase: 'revised_response',
    modelCalls: 2,
    toolCalls: 1,
    researchCycles: 1,
    evidenceReferences: [reference],
    pendingOperation: undefined,
    terminal: false,
  };
  return {
    run: () => runMultiAgentWorkflow(options, { resumeFrom }),
    provider,
    restoreEvidence,
  };
}
