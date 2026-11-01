import { providerSuccess } from '@orot/model-runtime';
import type { LanguageModelRequest } from '@orot/model-runtime';
import type { EvidenceReference, EvidenceItem } from '@orot/agent-runtime';
import * as openAI from '../../../providers/openai';
import { createAiFeatureServices } from '../featureServices';
import { runRagConversationTurn } from '../../../ragConversation/service';
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

function workflowFixture(allowWeb = true) {
  const run = publicEvidenceFixture();
  // Keep the real deletion guard and SQL reads; only replace the native database-opening port.
  const database = createDatabase();
  databases.push(database);
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);
  let turn = 0;
  const generate = jest.fn(async (request: LanguageModelRequest) => {
    turn++;
    if (turn <= 2)
      return providerSuccess({
        text: '',
        finishReason: 'tool_calls' as const,
        toolCalls: [
          {
            id: `call-${turn}`,
            name: turn === 1 ? 'local-reviewed-memory' : 'public-web-search',
            arguments: { query: 'Public concept' },
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
        citations,
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
    ragRunner: async (options, invocation) => {
      expect(options.workflow.execution.budget.maxModelCalls).toBe(4);
      expect(options.workflow.execution.budget.maxToolCalls).toBe(2);
      return runRagConversationTurn(options, invocation);
    },
  });
  return { ...run, generate, literature, services };
}

test('real feature orchestration combines a model-selected local tool and isolated web tool within four model calls', async () => {
  const run = workflowFixture();
  const result = await run.services.sendRagMessage(
    'Compare my record with general public web sources.',
    [],
  );
  expect(result.status).toBe('answer');
  if (result.status !== 'answer')
    throw new Error('Expected a grounded workflow result');
  expect(result.answer).toContain('공개 웹자료를 바탕으로 AI가 정리한 설명');
  expect(result.citations.map(reference => reference.sourceKind)).toEqual([
    'reviewed_memory',
    'external_medical',
  ]);
  expect(run.generate).toHaveBeenCalledTimes(3);
  expect(run.search).toHaveBeenCalledTimes(1);
  expect(run.generate.mock.calls.length + run.search.mock.calls.length).toBe(4);
  expect(run.search).toHaveBeenCalledWith(
    { query: 'Public concept' },
    { signal: expect.anything() },
  );
  expect(run.literature.search).not.toHaveBeenCalled();
  expect(
    run.authorize.mock.calls.filter(
      ([request]) => request.consentScope?.purpose === 'public_web_search',
    ),
  ).toHaveLength(1);
});

test('denied public-query permission stops its request without switching destination or model', async () => {
  const run = workflowFixture(false);
  const result = await run.services.sendRagMessage(
    'Compare my record with public sources.',
    [],
  );
  expect(result).toEqual({ status: 'failure', kind: 'consent_required' });
  expect(run.search).not.toHaveBeenCalled();
  expect(run.literature.search).not.toHaveBeenCalled();
  expect(run.generate).toHaveBeenCalledTimes(2);
});
