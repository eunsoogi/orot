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

/** Synthetic responses isolate the documented abstract filter; the native success case still uses live Europe PMC. */
async function runPublicFixture(forceMissingAbstract = false) {
  let requestedQuery: string | null = null;
  const service = createEuropePmcMedicalEvidenceService({
    fetcher: async url => {
      requestedQuery = new URL(url).searchParams.get('query');
      const abstractFilter = requestedQuery?.includes('HAS_ABSTRACT:y');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          resultList: {
            result: Array.from({ length: 5 }, (_, index) => ({
              id: String(100 + index),
              source: 'MED',
              title: 'Synthetic sleep literature ' + index,
              firstPublicationDate: '2025-01-01',
              // Model the observed fifth result without an abstract for an unfiltered query.
              abstractText:
                index === 4 && (forceMissingAbstract || !abstractFilter)
                  ? undefined
                  : 'Synthetic public abstract for workflow verification.',
            })),
          },
        }),
      };
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
      toolCalling: false,
    },
    async generate(request: LanguageModelRequest) {
      const reply = script[modelCalls++](request);
      return providerSuccess({
        text: reply.text!,
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
  return { result, modelCalls, batch, requestedQuery };
}

test('public success fixture reaches the third model call and cites retrieved evidence', async () => {
  const { result, modelCalls, batch, requestedQuery } =
    await runPublicFixture();
  expect(result.status).toBe('result');
  expect(modelCalls).toBe(3);
  expect(requestedQuery).toBe('(sleep duration adults) AND HAS_ABSTRACT:y');
  expect(batch?.items).toHaveLength(5);
  expect(batch?.coverage[0].gaps).toEqual([]);
  if (result.status !== 'result') throw new Error('Expected grounded result');
  expect(result.citations).toHaveLength(1);
  expect(result.citations[0].evidenceId).toBe('MED:100');
  expect(result.value.answer).toContain('mock');
});

test('missing abstracts still stop before the final model call despite the success query', async () => {
  const { result, modelCalls, batch } = await runPublicFixture(true);
  expect(modelCalls).toBe(2);
  expect(batch?.items).toHaveLength(5);
  expect(batch?.coverage[0].gaps).toEqual([
    'An abstract was unavailable for one or more Europe PMC results.',
  ]);
  expect(result).toMatchObject({
    status: 'needs_clarification',
    reason: 'The available evidence has gaps, conflicts, or truncation.',
  });
});
