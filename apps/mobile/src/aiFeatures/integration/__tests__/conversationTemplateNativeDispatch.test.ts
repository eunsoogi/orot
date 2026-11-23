import { createDailyReportIdentity } from '@orot/domain';
import {
  createChatGPTPlanProvider,
  type ChatGPTPlanNativeEvent,
  type ChatGPTPlanRequest,
} from '@orot/provider-openai';
import type { RagConversationObserver } from '../../../ragConversation/conversationObserver';
import { createConversationSummaryIntegration } from '../conversationSummaryIntegration';
import { createConversationDailyReport } from '../conversationDailyReport';
import { createConversationHealthSummary } from '../conversationHealthSummary';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import type { SelectedAiResolution } from '../provider';

jest.mock('../conversationDailyReport');
jest.mock('../conversationHealthSummary');

const today = createDailyReportIdentity('2035-01-02', 'Asia/Seoul');
const answer = {
  status: 'answer' as const,
  answer: 'Synthetic response',
  citations: [],
};

test.each([
  'daily-report',
  'health-summary',
  'possibilities',
  'visit-questions',
  'ordinary',
  'unsupported-capability',
  'strict-apple',
  'changed-owner',
])(
  'selected ChatGPT native tool adapter reaches exactly one existing downstream route: %s',
  async intent => {
    let receive: (event: ChatGPTPlanNativeEvent) => void = () => {};
    let ownerCurrent = true;
    const start = jest.fn(
      async (
        requestId: string,
        _account: string,
        _request: ChatGPTPlanRequest,
      ) => {
        receive({
          requestId,
          type: 'text_delta',
          text: 'Speculative router text must not escape.',
        });
        receive({
          requestId,
          type: 'completed',
          text: 'Speculative router text must not escape.',
          toolCalls: [
            {
              id: 'synthetic-function',
              name: 'propose_conversation_template',
              arguments: JSON.stringify({
                intent: intent === 'changed-owner' ? 'visit-questions' : intent,
              }),
            },
          ],
        });
        if (intent === 'changed-owner') ownerCurrent = false;
      },
    );
    const adapter = createChatGPTPlanProvider({
      issuedClientID: 'synthetic',
      model: { slug: 'selected-model', displayName: 'Selected Model' },
      bridge: {
        listModels: async () => [],
        subscribe(callback) {
          receive = callback;
          return () => {};
        },
        startResponse: start,
        cancelResponse: jest.fn(),
      },
    });
    const supported =
      intent !== 'unsupported-capability' && intent !== 'strict-apple';
    const provider = supported
      ? adapter
      : {
          ...adapter,
          id:
            intent === 'strict-apple' ? 'apple-foundation-models' : adapter.id,
          capabilities: { ...adapter.capabilities, toolCalling: false },
        };
    const selected = {
      status: 'ready',
      selection: { providerId: provider.id, modelId: 'selected-model' },
      recipient: 'synthetic-recipient',
      remoteProcessing: intent !== 'strict-apple',
      modelId: 'selected-model',
      option: { provider } as Extract<
        SelectedAiResolution,
        { status: 'ready' }
      >['option'],
      provider,
    } as const;
    const daily = jest.fn(async () => answer);
    const summary = jest.fn(async () => answer);
    const visit = jest.fn(async () => answer);
    const rag = jest.fn(async () => answer);
    const authorize = jest.fn(async () => 'authorized' as const);
    jest.mocked(createConversationDailyReport).mockReturnValue(daily);
    jest.mocked(createConversationHealthSummary).mockReturnValue(summary);
    const config: Parameters<typeof createConversationSummaryIntegration>[0] = {
      dailyReport: {} as never,
      dailyReportSources: {} as never,
      consent: { authorize },
      dependencies: {},
      loadData: jest.fn(async () => {
        throw new Error('Router must not read health data');
      }),
      selectedAi: async () => selected,
      registry: new LocalEvidenceReferenceRegistry(),
      diseaseRunner: jest.fn(),
      sendRagMessage: rag,
      loadSavedVisitQuestions: jest.fn(),
    };
    const app = createConversationSummaryIntegration(config);
    const observer: RagConversationObserver = {
      inputOrigin: 'composer',
      expectedConversationModel: {
        providerId: provider.id,
        modelId: selected.modelId,
        isCurrent: () => ownerCurrent,
        isDurablyCurrent: async () => true,
      },
      modelTemplateAdmission: {
        current: () => true,
        today,
        prepareVisit: visit,
      },
      retentionRequestId: 'synthetic-request',
      onTaskStreamEvent: jest.fn(),
      onRetentionCandidate: jest.fn(),
    };
    const authored = '다음 진료에서 무슨 얘기를 꺼낼지 정리해 줄래?';
    const history = [
      {
        role: 'assistant' as const,
        content: 'This prior turn must not be sent by routing.',
      },
    ];
    await expect(
      app.sendRagMessage(
        authored,
        history,
        new AbortController().signal,
        observer,
      ),
    ).resolves.toEqual(
      intent === 'changed-owner'
        ? { status: 'failure', kind: 'cancelled' }
        : answer,
    );
    if (intent === 'changed-owner') {
      expect(start).toHaveBeenCalledTimes(1);
      expect(
        [daily, summary, visit, rag].map(handler => handler.mock.calls.length),
      ).toEqual([0, 0, 0, 0]);
      return;
    }
    expect(start).toHaveBeenCalledTimes(Number(supported));
    if (!supported) {
      expect(authorize).not.toHaveBeenCalled();
      expect(
        [daily, summary, visit, rag].map(handler => handler.mock.calls.length),
      ).toEqual([0, 0, 0, 1]);
      expect(rag).toHaveBeenCalledWith(
        authored,
        history,
        expect.any(AbortSignal),
        observer,
        undefined,
      );
      return;
    }
    const [, account, wire] = start.mock.calls[0]!;
    expect(account).toBe('synthetic');
    expect(wire.model).toBe(selected.modelId);
    expect(wire.toolChoice).toBe('required');
    expect(
      wire.messages.filter(
        message => 'role' in message && message.role !== 'system',
      ),
    ).toEqual([{ role: 'user', content: authored }]);
    expect(wire.tools).toHaveLength(1);
    expect(config.loadData).not.toHaveBeenCalled();
    expect(observer.onRetentionCandidate).not.toHaveBeenCalled();
    expect(observer.onTaskStreamEvent).not.toHaveBeenCalled();
    expect(
      [daily, summary, visit, rag].map(handler => handler.mock.calls.length),
    ).toEqual([
      Number(intent === 'daily-report'),
      Number(intent === 'health-summary'),
      Number(intent === 'visit-questions'),
      Number(intent === 'ordinary' || intent === 'possibilities'),
    ]);
    if (intent === 'daily-report')
      expect(daily).toHaveBeenCalledWith(
        authored,
        today,
        expect.any(AbortSignal),
        expect.objectContaining({ suppressContextualOpening: true }),
        false,
      );
    if (intent === 'possibilities')
      expect(rag).toHaveBeenCalledWith(
        authored,
        history,
        expect.any(AbortSignal),
        expect.objectContaining({ suppressContextualOpening: true }),
        expect.objectContaining({ intent, typedPossibilityReport: true }),
      );
    if (intent === 'ordinary')
      expect(rag).toHaveBeenCalledWith(
        authored,
        history,
        expect.any(AbortSignal),
        expect.objectContaining({ suppressContextualOpening: true }),
        undefined,
      );
  },
);
