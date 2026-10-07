import {
  providerSuccess,
  type LanguageModelProvider,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import {
  createEuropePmcEvidenceSearchTool,
  type EvidenceReference,
  type EuropePmcAdapterPublication,
  type MultiAgentWorkflowOptions,
  type TaskResponderContract,
} from '../src';

export const publication: EuropePmcAdapterPublication = {
  provider: 'Europe PMC',
  recordId: '12345',
  source: 'MED',
  title: 'Synthetic literature fixture',
  authors: 'Fixture Author',
  journal: 'Synthetic Journal',
  publicationDate: '2025-02-10',
  updatedDate: '2025-03-15',
  abstract: 'Synthetic abstract used only to verify role handoff.',
  originalUrl: 'https://europepmc.org/article/MED/12345',
  retrievedAt: '2026-10-08T00:00:00.000Z',
};

export const reference: EvidenceReference = {
  sourceKind: 'external_medical',
  sourceId: 'europe-pmc',
  sourceRevision: 'retrieved:2026-10-08T00:00:00.000Z',
  evidenceId: 'MED:12345',
  evidenceRevision: 'updated:2025-03-15',
  locator: {
    provider: 'Europe PMC',
    source: 'MED',
    recordId: '12345',
    originalUrl: 'https://europepmc.org/article/MED/12345',
    publicationDate: '2025-02-10',
    updatedDate: '2025-03-15',
    retrievedAt: '2026-10-08T00:00:00.000Z',
    revisionBasis: 'provider_updated_date',
  },
  effectiveTime: '2025-02-10',
  reviewState: 'unknown',
};

export function makeProvider(outputs: readonly string[]) {
  const pending = [...outputs];
  const requests: LanguageModelRequest[] = [];
  const generate = jest.fn(async (request: LanguageModelRequest) => {
    requests.push(request);
    const text = pending.shift();
    if (!text) throw new Error('The deterministic provider fixture is exhausted.');
    return providerSuccess({ text, toolCalls: [], finishReason: 'complete' as const });
  });
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
    generate,
  };
  return { provider, requests, generate };
}

function makeTask(): TaskResponderContract<{ summary: string }> {
  return {
    taskType: 'synthetic-literature-review',
    taskVersion: '1',
    systemPrompt: 'Summarize only the current cited literature fixture.',
    resultSchema: {
      type: 'object',
      required: ['summary'],
      properties: { summary: { type: 'string' } },
      additionalProperties: false,
    },
    createMessages: ({ request, evidence }) => [
      { role: 'user', content: JSON.stringify({ request, evidence }) },
    ],
    validateResult(value) {
      if (!value || typeof value !== 'object' || typeof value.summary !== 'string') {
        return { status: 'invalid', reason: 'A summary is required.' };
      }
      return { status: 'valid', value: { summary: value.summary } };
    },
  };
}

export function workflowOptions(
  provider: LanguageModelProvider,
  tool: ReturnType<typeof createEuropePmcEvidenceSearchTool>,
): MultiAgentWorkflowOptions<{ summary: string }> {
  return {
    execution: {
      operationRunId: 'external-evidence-run-1',
      providerId: provider.id,
      modelId: 'selected-model',
      recipient: 'selected-account',
      remoteProcessing: true,
      allowedScope: { sourceKinds: ['external_medical'] },
      budget: {
        maxModelCalls: 3,
        maxToolCalls: 1,
        maxResearchCycles: 1,
        maxPayloadBytes: 64 * 1024,
        maxOutputTokens: 512,
        timeoutMs: 5000,
        maxEvidenceItems: 5,
      },
    },
    provider,
    request: 'Find literature for a synthetic test question.',
    task: makeTask(),
    initialEvidence: { items: [], coverage: [], conflicts: [] },
    tools: [tool],
    consent: { authorize: jest.fn(async () => 'authorized' as const) },
    revalidateEvidence: jest.fn(async () => true),
  };
}

export function scriptedOutputs() {
  return [
    JSON.stringify({ type: 'request_evidence', need: 'missing_coverage' }),
    JSON.stringify({
      toolId: 'europe-pmc-publication-search',
      sourceKind: 'external_medical',
      input: { query: 'synthetic external literature query' },
    }),
    JSON.stringify({
      type: 'result',
      value: { summary: 'The synthetic fixture contains one cited article.' },
      citations: [reference],
    }),
  ];
}
