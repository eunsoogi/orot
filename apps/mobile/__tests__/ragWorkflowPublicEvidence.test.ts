import { providerSuccess } from '@orot/model-runtime';
import type {
  LanguageModelProvider,
  LanguageModelRequest,
} from '@orot/model-runtime';
import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import type { EvidenceBatch } from '@orot/agent-runtime';
import { appleModelMockScript } from '../e2e/appleModelMockFixtures';
import { createEuropePmcMedicalEvidenceService } from '../src/externalMedicalEvidence/europePmc';
import { createExternalConversationEvidence } from '../src/aiFeatures/integration/externalConversationEvidence';
import { ragConversationTask } from '../src/ragConversation/task';
import { RAG_CONVERSATION_BUDGET } from '../src/ragConversation/budget';
import {
  createEuropePmcMockTransport,
  syntheticEuropePmcPayload,
} from '../e2e/europePmcMockTransport';
import { RAG_WORKFLOW_PUBLIC_QUERY } from '../e2e/appleModelMockFixtures';

/** Both JS and native success paths use provider-shaped HTTP fixtures and shipping evidence validation. */
async function runPublicFixture(forceMissingAbstract = false) {
  let requestedQuery: string | null = null;
  const transport = createEuropePmcMockTransport(
    RAG_WORKFLOW_PUBLIC_QUERY,
    syntheticEuropePmcPayload(forceMissingAbstract),
  );
  const service = createEuropePmcMedicalEvidenceService({
    fetcher: async (url, init) => {
      requestedQuery = new URL(url).searchParams.get('query');
      return transport.fetcher(url, init);
    },
  });
  const external = createExternalConversationEvidence(service, {
    authorize: async () => 'authorized',
  });
  const script = appleModelMockScript('rag-workflow');
  let modelCalls = 0;
  let batch: EvidenceBatch | undefined;
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: 'public-fixture-regression',
    displayName: 'Synthetic model script',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: true,
      toolCalling: true,
    },
    async generate(request: LanguageModelRequest) {
      const reply = script[modelCalls++](request);
      // Adapt raw mock SDK envelopes to the common provider contract. Native codec
      // behavior is covered separately by the Simulator integration test.
      const output = JSON.parse(reply.text!);
      if (output.kind === 'tool_calls') {
        return providerSuccess({
          text: '',
          toolCalls: output.toolCalls.map(
            (
              call: { name: string; arguments: { query: string } },
              index: number,
            ) => ({
              ...call,
              id: `public-fixture-${modelCalls}-${index}`,
            }),
          ),
          finishReason: 'tool_calls',
        });
      }
      return providerSuccess({
        text: JSON.stringify(
          output.kind === 'structured' ? output.value : output,
        ),
        toolCalls: [],
        finishReason: 'complete',
      });
    },
  };
  const result = await runMultiAgentWorkflow({
    provider,
    request: 'Synthetic public literature success scenario',
    task: ragConversationTask,
    initialEvidence: { items: [], coverage: [], conflicts: [] },
    execution: {
      operationRunId: 'public-fixture-regression',
      providerId: provider.id,
      modelId: 'synthetic',
      recipient: 'on-device',
      remoteProcessing: false,
      allowedScope: {
        sourceKinds: ['external_medical'],
        sourceIds: ['europe-pmc'],
      },
      budget: RAG_CONVERSATION_BUDGET,
    },
    tools: [
      {
        ...external.tool,
        async search(request) {
          const outcome = await external.tool.search(request);
          if ('items' in outcome) batch = outcome;
          return outcome;
        },
      },
    ],
    consent: { authorize: async () => 'authorized' },
    revalidateEvidence: async references =>
      references.every(reference => external.validates(reference)),
  });
  transport.assertComplete();
  return { result, modelCalls, batch, requestedQuery };
}

test('public success fixture calls a tool then cites retrieved evidence', async () => {
  const { result, modelCalls, batch, requestedQuery } =
    await runPublicFixture();
  expect(result.status).toBe('result');
  expect(modelCalls).toBe(2);
  expect(requestedQuery).toBe('(sleep duration adults) AND HAS_ABSTRACT:y');
  expect(batch?.items).toHaveLength(5);
  expect(batch?.coverage[0].gaps).toEqual([]);
  if (result.status !== 'result') throw new Error('Expected grounded result');
  expect(result.citations).toHaveLength(1);
  expect(result.citations[0].evidenceId).toBe('MED:100');
  expect(result.value.answer).toContain('mock');
});

test('missing abstracts still reject the final answer despite the success query', async () => {
  const { result, modelCalls, batch } = await runPublicFixture(true);
  // Native tool results are returned to the model even when incomplete; final
  // coverage validation must reject its otherwise well-formed answer.
  expect(modelCalls).toBe(2);
  expect(batch?.items).toHaveLength(5);
  expect(batch?.coverage[0].gaps).toEqual([
    'An abstract was unavailable for one or more Europe PMC results.',
  ]);
  expect(result).toMatchObject({
    status: 'needs_clarification',
    reason:
      'The available evidence has gaps, conflicts, truncation, or no coverage.',
  });
});
