import type {
  EvidenceBatch,
  MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import { providerSuccess } from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import type { DiseaseHypothesisAnalysis } from './task';

export const reference = {
  sourceKind: 'personal_record' as const,
  sourceId: 'record-1',
  sourceRevision: '1',
  evidenceId: 'evidence-1',
  evidenceRevision: '1',
  locator: { kind: 'structured_record', recordId: 'record-1' },
  effectiveTime: '2026-10-01T00:00:00.000Z',
  reviewState: 'reviewed' as const,
};

export const evidence: EvidenceBatch = {
  items: [{ ...reference, content: '사용자가 기록한 증상 경과' }],
  coverage: [
    {
      sourceKind: 'personal_record',
      searchedSourceIds: ['record-1'],
      gaps: [],
      truncated: false,
      resultLimit: 5,
      returnedCount: 1,
    },
  ],
  conflicts: [],
};

export function hypothesis(overrides: Record<string, unknown> = {}) {
  return {
    title: '검토할 가능성',
    summary: '기록된 증상과 일부 맞는 부분이 있어 검토할 수 있어요.',
    supportingEvidence: [reference],
    contraryEvidence: [],
    uncertainty: '현재 자료만으로는 판단할 수 없어요.',
    missingData: ['진료 기록'],
    ...overrides,
  };
}

// Use one deterministic provider fixture to exercise the public workflow boundary.
export function workflowOptionsFor(
  value: unknown,
): Omit<MultiAgentWorkflowOptions<DiseaseHypothesisAnalysis>, 'task'> {
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: 'selected-model',
    displayName: 'Selected model',
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
          value,
          citations: [reference],
        }),
        toolCalls: [],
        finishReason: 'complete' as const,
      }),
    ),
  };
  return {
    execution: {
      operationRunId: 'disease-hypothesis-test',
      providerId: provider.id,
      modelId: 'selected-model',
      recipient: 'selected-account',
      remoteProcessing: true,
      allowedScope: {
        sourceKinds: ['personal_record'],
        sourceIds: ['record-1'],
      },
      budget: {
        maxModelCalls: 3,
        maxToolCalls: 1,
        maxResearchCycles: 1,
        maxPayloadBytes: 32_000,
        maxOutputTokens: 512,
        timeoutMs: 5_000,
        maxEvidenceItems: 5,
      },
    },
    provider,
    request: '가능성을 살펴봐 주세요',
    initialEvidence: evidence,
    tools: [],
    consent: { authorize: async () => 'authorized' },
    revalidateEvidence: async () => true,
  };
}

export function completeInventory() {
  return {
    inventoryComplete: true,
    availableKinds: ['source_record'] as const,
    queriedKinds: ['source_record'] as const,
    unsupportedKinds: [],
    truncatedKinds: [],
  };
}

export function workflowOptions(): Omit<
  MultiAgentWorkflowOptions<DiseaseHypothesisAnalysis>,
  'task'
> {
  return workflowOptionsFor({ hypotheses: [hypothesis()] });
}
