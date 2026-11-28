import { act, render, screen, waitFor } from '@testing-library/react-native';
import { ConversationScreen } from '../ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../ConversationSessionsContext';
import type { ConversationExecutionAdapter } from '../conversationExecutionLease';
import type { ConversationScreenProps } from '../ConversationScreenProps';
import { setup } from '../testSupport/continuousSessionFixture';
import {
  countVisitFixtureCompletions,
  renderMountedVisitTemplate,
  submitVisitFixturePrompt,
} from '../testSupport/mountedVisitTemplateFixture';
import { providerSelectionStore } from '../../providers/selection/keychainSelectionStore';
import { nativeChatGPTSelectionServices } from '../../providers/selection/chatGPTServices';
import { appointment } from '../../agent/visitQuestions/testing/persistenceFixtures';
import { continuousSessionOption } from '../../aiFeatures/integration/continuousSessionOption';
import { createConversationSummaryIntegration } from '../../aiFeatures/integration/conversationSummaryIntegration';
import { createConversationDailyReport } from '../../aiFeatures/integration/conversationDailyReport';
import { createConversationHealthSummary } from '../../aiFeatures/integration/conversationHealthSummary';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { syntheticTemplateTransport } from '../../aiFeatures/integration/testSupport/conversationTemplateTransportFixture';

jest.mock('../ConversationSavedRecaps', () => ({
  ConversationSavedRecaps: () => null,
}));
jest.mock('../../aiFeatures/integration/conversationDailyReport');
jest.mock('../../aiFeatures/integration/conversationHealthSummary');

test.each([
  ['visit-questions', '다음 진료 질문 만들어줘'],
  ['daily-report', '오늘 건강 기록을 일일 보고서로 만들어줘'],
  ['health-summary', '전체 건강 정보를 중요한 부분만 요약해줘'],
  ['possibilities', '내 건강 기록에서 질환 가능성을 정리해줘'],
  ['ordinary', '다음 진료 일정이 언제야?'],
  ['late-visit', '다음 진료 질문 만들어줘'],
] as const)(
  'owned Plan composer routes the completed proposal into the matching app action (%s)',
  async (intent, prompt) => {
    const f = await setup();
    const lateVisit = intent === 'late-visit';
    let release!: () => void;
    const hold = new Promise<void>(resolve => {
      release = resolve;
    });
    const plan = syntheticTemplateTransport(
      'chatgpt',
      lateVisit ? 'visit-questions' : intent,
      () => {},
      lateVisit ? () => hold : undefined,
    );
    const { provider } = plan;
    const modelId = 'selected-model';
    const selection = { providerId: provider.id, modelId };
    const selected = {
      status: 'ready' as const,
      selection,
      provider,
      modelId,
      option: {
        provider,
        modelId,
        displayName: 'Synthetic Plan',
        privacyBoundary: 'selected-context-remote' as const,
        availability: { status: 'available' as const },
      },
      remoteProcessing: true,
      recipient: 'Synthetic selected Plan',
    };
    // Mock only the operating-system lease and selected Plan's transport. Use
    // SQLite's actual current request proof rather than injecting an observer.
    const execution: ConversationExecutionAdapter = {
      bridgeAvailable: true,
      currentPhase: () => 'active',
      protectedDataAvailable: async () => true,
      begin: async () => true,
      isActive: async () => true,
      end: jest.fn(),
      subscribe: () => () => {},
    };
    const options = {
      ...f.options,
      ...continuousSessionOption(
        async () => selected,
        async () => f.storage,
        () => id => (id === provider.id ? () => true : null),
      ),
      execution,
    };
    const answer = '합성 작업 완료';
    const finish: ConversationScreenProps['onSend'] = async (
      question,
      _history,
      signal,
      observer,
    ) => {
      const { rows } = await f.database.execute(
        "SELECT id FROM conversation_requests WHERE status = 'active'",
      );
      expect(rows).toEqual([{ id: observer?.retentionRequestId }]);
      await observer?.onRetentionCandidate?.(
        {
          question,
          answer,
          providerId: provider.id,
          modelId,
          sources: [],
          citations: [],
        },
        signal!,
      );
      return { status: 'answer', answer, citations: [] };
    };
    const visit = jest.fn<
      ReturnType<NonNullable<ConversationScreenProps['prepareVisitQuestions']>>,
      Parameters<NonNullable<ConversationScreenProps['prepareVisitQuestions']>>
    >(async (...args) => ({
      ...(await finish(...args)),
      status: 'answer',
      answer,
      citations: [],
      visitQuestions: {
        appointment,
        review: {
          ownerKey: 'synthetic',
          items: [],
          caveats: [],
          expectedSavedQuestions: [],
        },
        validateSource: async () => true,
      },
    }));
    const rag = jest.fn(finish);
    // Other actions are endpoint spies: this test checks routing, not health analysis.
    const daily = jest.fn<
      ReturnType<ReturnType<typeof createConversationDailyReport>>,
      Parameters<ReturnType<typeof createConversationDailyReport>>
    >((question, _today, signal, observer) =>
      finish(question, [], signal, observer),
    );
    const summary = jest.fn<
      ReturnType<ReturnType<typeof createConversationHealthSummary>>,
      Parameters<ReturnType<typeof createConversationHealthSummary>>
    >(({ question }, signal, observer) =>
      finish(question, [], signal, observer),
    );
    jest.mocked(createConversationDailyReport).mockReturnValue(daily);
    jest.mocked(createConversationHealthSummary).mockReturnValue(summary);
    const authorize = jest.fn(async () => 'authorized' as const);
    const integration = createConversationSummaryIntegration({
      dailyReport: {} as never,
      dailyReportSources: {} as never,
      consent: { authorize },
      dependencies: {},
      loadData: async () => {
        throw new Error('Proposal cannot access contextual health data');
      },
      selectedAi: async () => selected,
      registry: new LocalEvidenceReferenceRegistry(),
      diseaseRunner: jest.fn(),
      sendRagMessage: rag,
      loadSavedVisitQuestions: jest.fn(),
    });
    const loadSelection = jest
      .spyOn(providerSelectionStore, 'load')
      .mockResolvedValue(selection);
    const loadAccount = jest
      .spyOn(nativeChatGPTSelectionServices, 'loadAccountSummary')
      .mockResolvedValue({
        issuedClientID: 'synthetic',
        requiresSignIn: false,
        hasDirectPlanAccess: true,
      });
    let sessions: ReturnType<typeof useConversationSessions> | undefined;
    function Composer() {
      sessions = useConversationSessions();
      return (
        <ConversationScreen
          onSend={integration.sendRagMessage}
          prepareVisitQuestions={visit}
          renderVisitQuestions={renderMountedVisitTemplate}
          onBack={jest.fn()}
          onOpenSource={jest.fn()}
        />
      );
    }
    const view = await render(
      <ConversationSessionsProvider options={options}>
        <Composer />
      </ConversationSessionsProvider>,
    );
    try {
      await act(async () => {
        await sessions?.synchronizeModel();
      });
      await submitVisitFixturePrompt(prompt);
      if (lateVisit) {
        await waitFor(() => expect(plan.calls()).toBe(1));
        // Hold this exact native response beyond the former cutoff.
        await act(async () => {
          await new Promise(resolve => setTimeout(resolve, 2_600));
          expect(rag).not.toHaveBeenCalled();
          release();
        });
      }
      if (intent === 'visit-questions' || lateVisit) {
        await screen.findByTestId('inline-visit-regenerate');
        expect(visit.mock.calls[0]?.[4]).toMatchObject({
          intent: 'visit-questions',
        });
      } else {
        await screen.findByText(answer, undefined, { timeout: 6_000 });
        expect(screen.queryByTestId('inline-visit-regenerate')).toBeNull();
      }
      expect(
        [visit, daily, summary, rag].map(handler => handler.mock.calls.length),
      ).toEqual([
        Number(intent === 'visit-questions' || lateVisit),
        Number(intent === 'daily-report'),
        Number(intent === 'health-summary'),
        Number(intent === 'ordinary' || intent === 'possibilities'),
      ]);
      if (intent === 'possibilities')
        expect(rag.mock.calls[0]?.[4]).toMatchObject({
          intent,
          typedPossibilityReport: true,
        });
      if (intent === 'ordinary') expect(rag.mock.calls[0]?.[4]).toBeUndefined();
      expect(loadAccount).toHaveBeenCalledTimes(1);
      expect(plan.calls()).toBe(1);
      plan.assertRequest(prompt);
      expect(authorize).toHaveBeenCalledTimes(1);
      expect(await countVisitFixtureCompletions(f.database)).toBe(1);
    } finally {
      release();
      await view.unmount();
      loadSelection.mockRestore();
      loadAccount.mockRestore();
      f.store.dispose();
      f.close();
    }
  },
);
