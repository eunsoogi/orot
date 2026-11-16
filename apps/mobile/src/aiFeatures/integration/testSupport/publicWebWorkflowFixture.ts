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

// Build real orchestration with synthetic provider ports and an isolated local database.
export function workflowFixture(
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
