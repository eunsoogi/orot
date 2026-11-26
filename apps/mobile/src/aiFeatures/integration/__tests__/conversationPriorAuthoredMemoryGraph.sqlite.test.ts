import { createDailyReportIdentity } from '@orot/domain';
import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import {
  createManualHistoryRepository,
  isLocalConversationMemoryId,
} from '@orot/storage';
import {
  providerSuccess,
  type LanguageModelRequest,
  type LanguageModelResponse,
} from '@orot/model-runtime';
import { runRagConversationTurn } from '../../../ragConversation/service';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';
import {
  consumeConversationEntryForSession,
  conversationEntryForSession,
  setConversationEntryForSession,
} from '../../../ragConversation/useConversationEntryIntent';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { saveConversationHealthHistory } from '../../../storage/conversationHealthHistory';
import { recoverConversationHealthHistoryResult } from '../../../storage/recoverConversationHealthHistory';
import { createConversationSummaryIntegration } from '../conversationSummaryIntegration';
import { createRagConversationService } from '../ragConversationService';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { apple, localData } from '../featureServiceFixtures';
import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';

const question = '그래 그럼 기억해줘';
const statement = '라일락 프로젝트의 데모는 금요일인 것 같아요.';
const assistant = '합성 답변입니다.';
const model = { providerId: APPLE_PROVIDER_ID, modelId: apple.modelId };
const old = {
  id: 'prior-user-source',
  sessionId: 'private-fixture',
  sessionVersion: 0,
  createdAt: '2026-11-26T00:00:00.000Z',
  question: statement,
};
const request = {
  ...old,
  id: 'current-request',
  createdAt: '2026-11-26T00:00:01.000Z',
  question,
};

// Actual summary router, protected history reader, workflow, write and
// terminal receipt. Only model output and native consent are synthetic.
test.each([
  'saved',
  'saved after consumed Daily Report',
  'declined',
  'deleted in approval',
  'retired in approval',
  'invented',
  'assistant',
  'no call',
] as const)(
  'the local model resolves a prior user statement without a filler fallback: %s',
  async outcome => {
    const f = await healthContextFixture();
    const sessions = createConversationSessions();
    try {
      const storage = createConversationArtifactStorage(f.database);
      const generation = await storage.currentGeneration();
      await storage.createSession(old.sessionId, generation);
      await storage.startRequest(old);
      await storage.append({
        ...old,
        providerId: model.providerId,
        modelId: model.modelId,
        status: 'complete',
        answer: assistant,
        sources: [],
      });
      const { activeId } = sessions.getSnapshot();
      const afterDaily = outcome === 'saved after consumed Daily Report';
      const authoredQuestion = afterDaily
        ? '앞으로도 전에 말한 내용을 기억해줄 수 있나요?'
        : question;
      if (afterDaily) {
        const reportRequest = createDailyReportIdentity('2026-11-26', 'UTC');
        setConversationEntryForSession(sessions, activeId, {
          intent: 'daily-report',
          entryKey: 'synthetic-consumed-report',
          reportRequest,
        });
        consumeConversationEntryForSession(sessions, activeId);
        expect(conversationEntryForSession(sessions, activeId)).toMatchObject({
          intent: 'conversation',
          reportRequest,
        });
      }
      await storage.startRequest({ ...request, question: authoredQuestion });
      const generate = jest.fn(async (value: LanguageModelRequest) => {
        expect(
          value.tools?.some(
            tool => tool.name === 'remember-prior-user-statement',
          ),
        ).toBe(true);
        expect(JSON.stringify(value)).not.toContain(old.id);
        return providerSuccess<LanguageModelResponse>({
          text: 'Model cannot assert a successful save.',
          finishReason: outcome === 'no call' ? 'complete' : 'tool_calls',
          toolCalls:
            outcome === 'no call'
              ? []
              : [
                  {
                    id: 'selected-source',
                    name: 'remember-prior-user-statement',
                    arguments: {
                      userMessage:
                        outcome === 'invented'
                          ? '그래 그럼'
                          : outcome === 'assistant'
                            ? assistant
                            : statement,
                    },
                  },
                ],
        });
      });
      const selectedAi = async () => ({
        status: 'ready' as const,
        selection: model,
        option: apple,
        provider: {
          ...apple.provider,
          id: APPLE_PROVIDER_ID,
          generate,
          capabilities: {
            ...apple.provider.capabilities,
            toolCalling: true,
            structuredOutput: false,
          },
        },
        modelId: model.modelId,
        recipient: 'Synthetic on-device',
        remoteProcessing: false,
      });
      const registry = new LocalEvidenceReferenceRegistry();
      const consent = { authorize: jest.fn(async () => 'authorized' as const) };
      const externalSearch = jest.fn();
      const writer = jest.fn(
        (...args: Parameters<typeof saveConversationHealthHistory>) =>
          saveConversationHealthHistory(...args),
      );
      const loadData = async () => ({
        ...localData([]).data,
        openConversationArtifactStorage: async () => storage,
        saveConversationHistory: (
          ...args: Parameters<typeof writer> extends [unknown, ...infer R]
            ? R
            : never
        ) => writer(f.database, ...args),
        recoverConversationHistoryResult: (
          value: Parameters<typeof recoverConversationHealthHistoryResult>[1],
          signal: AbortSignal,
        ) => recoverConversationHealthHistoryResult(f.database, value, signal),
      });
      const sendRagMessage = createRagConversationService({
        selectedAi,
        consent,
        queryConsent: consent,
        registry,
        externalEvidence: { search: externalSearch },
        loadLocalData: loadData,
        ragRunner: runRagConversationTurn,
      });
      const route = createConversationSummaryIntegration({
        selectedAi,
        consent,
        dependencies: {},
        registry,
        loadData,
        diseaseRunner: jest.fn(),
        loadSavedVisitQuestions: jest.fn(),
        sendRagMessage,
      });
      let retired = false;
      let revoke = () => {};
      const confirmHistorySave = jest.fn(async () => {
        if (outcome === 'deleted in approval')
          await f.database.execute(
            'DELETE FROM conversation_artifacts WHERE id = ?',
            [old.id],
          );
        if (outcome === 'retired in approval') {
          retired = true;
          revoke();
        }
        return outcome !== 'declined';
      });
      const response = await route.sendRagMessage(
        authoredQuestion,
        [],
        new AbortController().signal,
        {
          inputOrigin: 'composer',
          expectedConversationModel: model,
          retentionSession: { id: old.sessionId, version: 0 },
          retentionRequestId: request.id,
          retainedHistory: [{ id: old.id, question: old.question }],
          confirmHistorySave,
          templateProposalOwner: {
            ...model,
            current: () => !retired,
            recheck: async () => !retired,
            watch: listener => {
              revoke = listener;
              return () => {};
            },
          },
        },
        conversationEntryForSession(sessions, activeId),
      );
      const notes = await createManualHistoryRepository(f.database).list();
      if (outcome === 'saved' || afterDaily) {
        expect(response).toMatchObject({
          status: 'answer',
          committedAnswerMemory: true,
        });
        expect(notes.map(note => note.details)).toEqual([statement]);
        expect(isLocalConversationMemoryId(notes[0]!.id)).toBe(true);
        expect(
          await createManualHistoryRepository(f.database).getEvidence(
            notes[0]!.id,
          ),
        ).toBeNull();
        expect(confirmHistorySave).toHaveBeenCalledWith(
          statement,
          expect.anything(),
        );
        expect(writer).toHaveBeenCalledTimes(1);
      } else {
        expect(response).not.toHaveProperty('committedAnswerMemory');
        expect(notes).toEqual([]);
      }
      if (['invented', 'assistant', 'no call'].includes(outcome))
        expect(confirmHistorySave).not.toHaveBeenCalled();
      expect(externalSearch).not.toHaveBeenCalled();
      if (outcome !== 'no call') expect(generate).toHaveBeenCalledTimes(1);
    } finally {
      sessions.dispose();
      f.close();
    }
  },
);
