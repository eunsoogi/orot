import { createDailyReportIdentity } from '@orot/domain';
import { syntheticTemplateTransport } from '../testSupport/conversationTemplateTransportFixture';
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

const intents = [
  'daily-report',
  'health-summary',
  'possibilities',
  'visit-questions',
  'ordinary',
  'unsupported-capability',
  'changed-owner',
] as const;
const typed = {
  'daily-report': '오늘 하루 건강 기록으로 오늘의 보고서를 만들어 줘.',
  'health-summary': '지금까지 내 건강 정보에서 중요한 부분을 요약해 줘.',
  possibilities: '내 기록에서 살펴볼 질병 가능성을 따로 보고서로 만들어 줘.',
  'visit-questions':
    '기록과 근거를 참고해서 다음 진료에서 물어볼 질문을 준비해 줘.',
  ordinary: '다음 진료에서 검사 결과를 꼭 물어봐야 할까?',
  'unsupported-capability': '내 건강 기록을 요약해서 보고서로 정리해 줘.',
  'changed-owner': '다음 진료에서 물어볼 질문을 준비해 줘.',
} satisfies Record<(typeof intents)[number], string>;
const cases = (['chatgpt', 'apple'] as const).flatMap(adapter =>
  intents.map(intent => [adapter, intent] as const),
);

test.each(cases)(
  'the same template contract uses only selected %s on %s',
  async (adapter, intent) => {
    let ownerCurrent = true;
    const native = syntheticTemplateTransport(
      adapter,
      intent === 'changed-owner' ? 'visit-questions' : intent,
      () => {
        if (intent === 'changed-owner') ownerCurrent = false;
      },
    );
    const supported = intent !== 'unsupported-capability';
    const provider = supported
      ? native.provider
      : {
          ...native.provider,
          generate: native.provider.generate.bind(native.provider),
          capabilities: { ...native.provider.capabilities, toolCalling: false },
        };
    const selected = {
      status: 'ready',
      selection: { providerId: provider.id, modelId: 'selected-model' },
      recipient: 'synthetic-recipient',
      remoteProcessing: adapter === 'chatgpt',
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
      templateProposalOwner: {
        providerId: provider.id,
        modelId: selected.modelId,
        current: () => ownerCurrent,
        recheck: async () => true,
        watch: () => () => {},
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
    const authored = typed[intent];
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
      expect(native.calls()).toBe(1);
      expect(
        [daily, summary, visit, rag].map(handler => handler.mock.calls.length),
      ).toEqual([0, 0, 0, 0]);
      return;
    }
    expect(native.calls()).toBe(Number(supported));
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
    native.assertRequest(
      authored,
      intent === 'visit-questions'
        ? 'Supporting context or focus for one requested deliverable is not a second task'
        : undefined,
    );
    expect(authorize).toHaveBeenCalledTimes(Number(selected.remoteProcessing));
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
