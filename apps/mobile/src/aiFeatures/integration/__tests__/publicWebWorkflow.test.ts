import { providerSuccess } from '@orot/model-runtime';
import type { JsonObject, LanguageModelRequest } from '@orot/model-runtime';
import type { EvidenceReference, EvidenceItem } from '@orot/agent-runtime';
import * as openAI from '../../../providers/openai';
import { createAiFeatureServices } from '../featureServices';
import { runRagConversationTurn } from '../../../ragConversation/service';
import type { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';
import {
  apple,
  localData,
  memoryRecord,
  selectionStore,
} from '../featureServiceFixtures';
import { referenceOnly } from '../../../diseaseHypotheses/resultValidation';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import { createDatabase } from '../../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import type { SqlDatabase } from '@orot/storage';
import { openLocalAgentMemoryDatabase } from '../../../storage/secureDatabase';

jest.mock('../../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));
const databases: SqlDatabase[] = [];
afterEach(async () => {
  jest.restoreAllMocks();
  for (const database of databases.splice(0)) await database.closeAsync?.();
});

function workflowFixture(
  allowWeb = true,
  diseaseRunner?: typeof runDiseaseHypothesisAnalysis,
) {
  const run = publicEvidenceFixture();
  // Keep the real deletion guard and SQL reads; only replace the native database-opening port.
  const database = createDatabase();
  databases.push(database);
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);
  let turn = 0;
  let publicReference: EvidenceReference | undefined;
  const generate = jest.fn(async (request: LanguageModelRequest) => {
    turn++;
    if (turn === 1)
      return providerSuccess({
        text: '',
        finishReason: 'tool_calls' as const,
        toolCalls: [
          {
            id: `call-${turn}`,
            name: 'local-reviewed-memory',
            arguments: { query: 'Public concept' } as JsonObject,
          },
        ],
      });
    const citations: EvidenceReference[] = request.messages.flatMap(message => {
      if (
        message.role !== 'tool' ||
        !message.result ||
        typeof message.result !== 'object' ||
        Array.isArray(message.result)
      )
        return [];
      const value = message.result as Record<string, unknown>;
      return Array.isArray(value.items)
        ? value.items.map(item => referenceOnly(item as EvidenceItem))
        : [];
    });
    return providerSuccess({
      text: JSON.stringify({
        type: 'result',
        value: {
          answerKind: 'grounded',
          answer: '저장 메모와 공개 웹자료를 함께 참고했어요.',
        },
        citations: [
          ...citations,
          ...(publicReference ? [publicReference] : []),
        ],
      }),
      toolCalls: [],
      finishReason: 'complete' as const,
    });
  });
  const provider = {
    ...run.selected.provider,
    capabilities: {
      ...run.selected.provider.capabilities,
      streaming: false,
      structuredOutput: false,
      toolCalling: true,
    },
    generate,
  };
  jest.spyOn(openAI, 'createOpenAIPlanProvider').mockReturnValue(provider);
  if (!allowWeb)
    run.authorize.mockImplementation(async request =>
      request.consentScope?.purpose === 'public_web_search'
        ? 'renewal_required'
        : 'authorized',
    );
  const literature = { search: jest.fn() };
  const services = createAiFeatureServices(run.consent, {
    selectedAi: {
      selectionStore: selectionStore(run.selected.selection),
      loadAppleOption: async () => apple,
      chatGPTServices: {
        listAccounts: async () => [
          {
            issuedClientID: 'synthetic',
            requiresSignIn: false,
            hasDirectPlanAccess: true,
          },
        ],
        listModels: async () =>
          providerSuccess([
            { id: provider.id, slug: 'gpt-6-luna', displayName: 'GPT-6-Luna' },
          ]),
        signIn: jest.fn(),
        signOut: jest.fn(),
        cancelSignIn: jest.fn(),
      },
    },
    loadLocalData: async () => localData([memoryRecord(1)]).data,
    externalEvidence: literature,
    diseaseRunner,
    ragRunner: async (options, invocation) => {
      expect(options.workflow.execution.budget.maxModelCalls).toBe(
        allowWeb ? 3 : 4,
      );
      expect(options.workflow.execution.budget.maxToolCalls).toBe(2);
      publicReference = options.publicEvidence?.items[0]
        ? referenceOnly(options.publicEvidence.items[0])
        : undefined;
      return runRagConversationTurn(options, invocation);
    },
  });
  return { ...run, generate, literature, services };
}

test('disease analysis executes the public lookup before its model workflow', async () => {
  const runner = jest.fn(
    async (options: Parameters<typeof runDiseaseHypothesisAnalysis>[0]) => {
      expect(options.initialEvidence.items[0]?.sourceId).toBe('public-web');
      return {
        status: 'incomplete_inventory' as const,
        reason: 'unavailable' as const,
      };
    },
  );
  const run = workflowFixture(true, runner);
  await run.services.generateDiseaseHypotheses();
  expect(run.search).toHaveBeenCalledTimes(1);
  expect(runner).toHaveBeenCalledTimes(1);
  expect(run.search.mock.invocationCallOrder[0]).toBeLessThan(
    runner.mock.invocationCallOrder[0]!,
  );
});

test('denied search still returns the local analysis with a visible limitation', async () => {
  const runner = jest.fn(
    async (options: Parameters<typeof runDiseaseHypothesisAnalysis>[0]) => {
      expect(options.initialEvidence.items).toEqual([]);
      expect(
        options.tools.every(tool => tool.sourceKind !== 'external_medical'),
      ).toBe(true);
      return {
        status: 'workflow' as const,
        result: {
          status: 'result' as const,
          value: {
            hypotheses: [
              {
                title: '로컬 결과',
                summary: '기록 요약',
                uncertainty: '확인 필요',
                missingData: [],
                supportingEvidence: [],
                contraryEvidence: [],
              },
            ],
          },
          citations: [],
          coverage: [],
          checkpoint: {} as never,
        },
      };
    },
  );
  const run = workflowFixture(false, runner);
  const result = await run.services.generateDiseaseHypotheses();
  expect(run.search).not.toHaveBeenCalled();
  if (result.status !== 'workflow' || result.result.status !== 'result')
    throw new Error('Expected local result');
  expect(result.result.value.hypotheses[0]?.summary).toBe('기록 요약');
  expect(result.result.value.hypotheses[0]?.uncertainty).toContain(
    '동의가 없어',
  );
});

test('real feature orchestration combines default web search and a local tool within four model calls', async () => {
  const run = workflowFixture();
  const result = await run.services.sendRagMessage(
    'Compare my record with general public web sources.',
    [],
  );
  expect(result.status).toBe('answer');
  if (result.status !== 'answer')
    throw new Error('Expected a grounded workflow result');
  expect(result.answer).toContain('공개 웹자료를 바탕으로 AI가 정리한 설명');
  expect(result.citations.map(reference => reference.sourceKind)).toEqual(
    expect.arrayContaining(['reviewed_memory', 'external_medical']),
  );
  expect(run.generate).toHaveBeenCalledTimes(2);
  expect(run.search).toHaveBeenCalledTimes(1);
  expect(run.generate.mock.calls.length + run.search.mock.calls.length).toBe(3);
  expect(run.search).toHaveBeenCalledWith(
    {
      query:
        'General public health information about: general health. Guidelines, associations, possible explanations and limitations.',
    },
    { signal: expect.anything() },
  );
  expect(run.literature.search).not.toHaveBeenCalled();
  expect(
    run.authorize.mock.calls.filter(
      ([request]) => request.consentScope?.purpose === 'public_web_search',
    ),
  ).toHaveLength(1);
});

test('denied public-query permission preserves the local answer without switching destination or model', async () => {
  const run = workflowFixture(false);
  const result = await run.services.sendRagMessage(
    'Compare my record with public sources.',
    [],
  );
  expect(result.status).toBe('answer');
  if (result.status !== 'answer') throw new Error('Expected local answer');
  expect(result.answer).toContain('공개 웹검색 동의가 없어');
  expect(run.search).not.toHaveBeenCalled();
  expect(run.literature.search).not.toHaveBeenCalled();
  expect(run.generate).toHaveBeenCalledTimes(2);
});
