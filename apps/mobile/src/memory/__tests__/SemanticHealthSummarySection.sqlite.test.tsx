import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import { createConversationSummaryIntegration } from '../../aiFeatures/integration/conversationSummaryIntegration';
import {
  apple,
  localData,
} from '../../aiFeatures/integration/featureServiceFixtures';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { window } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { installReceiptFixturePlatform } from '../../aiFeatures/integration/testSupport/conversationReceiptFixturePlatform';
import { ConversationScreen } from '../../ragConversation/ConversationScreen';
import { ConversationSessionsProvider } from '../../ragConversation/ConversationSessionsContext';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import {
  setup,
  date,
} from '../../storage/testSupport/conversationHistoryDisplayFixture';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { t } from '../../i18n';
import {
  expectedHealthSummaryMemoryTools,
  healthSummarySectionCases,
  healthSummarySectionModel,
  replaceSelection,
  submitHealthSummaryMemoryMessage,
} from '../testSupport/healthSummarySectionRequests';
import { healthSummarySectionSelectedModel } from '../testSupport/healthSummarySectionSelectedModel';
import { expectSavedHealthSummarySectionDetail } from '../testSupport/expectSavedHealthSummarySectionDetail';
import { openSavedGeneratedReportReferences } from '../openSavedGeneratedReportReferences';

jest.mock('../../ragConversation/conversationExecutionNative');
jest.mock('../openSavedGeneratedReportReferences');
const section = {
  title: 'Synthetic chosen section',
  summary: 'Synthetic chosen content',
};
const active = Object.assign(() => true, {
  route: { isCurrent: () => true, subscribe: () => () => {} },
});
test.each(healthSummarySectionCases)(
  'keeps only an explicitly requested generated section, or preserves normal routing: $mode ($question)',
  async fixture => {
    const { mode, question } = fixture;
    const f = await setup();
    const previousState = AppState.currentState;
    AppState.currentState = 'active';
    const restore = installReceiptFixturePlatform(() => {});
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    let available = true;
    let view: Awaited<ReturnType<typeof render>> | undefined;
    jest.mocked(conversationExecutionNative).mockReturnValue({
      bridgeAvailable: true,
      currentPhase: () => 'active',
      protectedDataAvailable: async () => available,
      subscribe: () => () => {},
      begin: async () => true,
      isActive: async () => true,
      end: () => {},
    });
    const run = jest.fn(
      async (
        ..._args: Parameters<
          ReturnType<
            typeof createConversationSummaryIntegration
          >['sendRagMessage']
        >
      ) => ({
        status: 'answer' as const,
        answer: 'Ordinary synthetic reply',
        citations: [],
      }),
    );
    let release = () => {};
    const hold = new Promise<void>(resolve => {
      release = resolve;
    });
    const generate = healthSummarySectionModel(
      fixture,
      () => {
        available = false;
      },
      hold,
    );
    try {
      const option = {
        ...apple,
        provider: {
          ...apple.provider,
          generate,
          capabilities: { ...apple.provider.capabilities, toolCalling: true },
        },
      };
      const { model, selectedAi } = healthSummarySectionSelectedModel(
        option,
        mode,
      );
      const database = f.db;
      const storage = createConversationArtifactStorage(
        database,
        handle => handle === database,
      );
      const read = jest.spyOn(storage, 'readExactHealthSummarySections');
      jest
        .mocked(openSavedGeneratedReportReferences)
        .mockResolvedValue(storage);
      const session = await storage.continuousSession(
        model,
        'fixture-active',
        date,
        new AbortController().signal,
      );
      const first = f.saved.analysis.hypotheses[0]!;
      const original = {
        ...f.saved,
        analysis: {
          ...f.saved.analysis,
          hypotheses: [first, { ...first, ...section }],
        },
      };
      await f.summaryStorage.append(original);
      await f.save('owned-summary', {
        sessionId: session.id,
        question: 'Earlier synthetic prompt',
        providerId: original.providerId,
        modelId: original.modelId,
        healthSummary: { summaryId: original.id, window },
      });
      const loadLocalData = async () => ({
        ...localData([]).data,
        openConversationArtifactStorage: async () => storage,
      });
      const authorize = jest.fn(async () => {
        if (mode === 'selection-before') await replaceSelection();
        return 'authorized' as const;
      });
      const integration = createConversationSummaryIntegration({
        consent: { authorize },
        dependencies: {},
        selectedAi,
        registry: new LocalEvidenceReferenceRegistry(),
        loadData: loadLocalData,
        diseaseRunner: jest.fn(),
        sendRagMessage: run,
        loadSavedVisitQuestions: jest.fn(),
      });
      const send = jest.fn(integration.sendRagMessage);
      view = await render(
        <ConversationSessionsProvider
          options={integration.conversationSessionOptions()}
        >
          <ConversationScreen
            onSend={send}
            isEntryCurrent={active}
            onBack={jest.fn()}
            onOpenSource={jest.fn()}
          />
        </ConversationSessionsProvider>,
      );
      await screen.findByTestId('health-summary-card');
      await submitHealthSummaryMemoryMessage(question);
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      if (mode === 'stop-during-classifier') {
        await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
        await fireEvent(
          screen.getByTestId('rag-conversation-cancel'),
          'composerPress',
        );
        expect(await send.mock.results[0]?.value).toMatchObject({
          status: 'failure',
          kind: 'cancelled',
        });
        expect(read).not.toHaveBeenCalled();
        expect(run).not.toHaveBeenCalled();
        return;
      }
      const outcome = await send.mock.results[0]?.value;
      const modelTools = generate.mock.calls.map(
        ([call]) => call.tools?.[0]?.name,
      );
      const stock = mode === 'ordinary' || mode === 'whole-summary';
      if (stock) {
        const delegated = run.mock.calls[0]?.[3];
        expect(run).toHaveBeenCalledTimes(1);
        expect(Boolean(delegated?.reportBookmark)).toBe(
          mode === 'whole-summary',
        );
        await screen.findByText('Ordinary synthetic reply');
        expect(read).not.toHaveBeenCalled();
        if (mode === 'ordinary') {
          await submitHealthSummaryMemoryMessage(
            'Another independent question.',
          );
          await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
          expect(
            generate.mock.calls.filter(
              ([call]) => call.tools?.[0]?.name === 'classify-memory-request',
            ),
          ).toHaveLength(1);
          expect(read).not.toHaveBeenCalled();
        }
      } else {
        expect(run).not.toHaveBeenCalled();
        expect(outcome).toMatchObject(
          mode === 'selected'
            ? { status: 'answer', committedAnswerMemory: true }
            : { status: 'failure' },
        );
      }
      expect(modelTools).toEqual(expectedHealthSummaryMemoryTools(mode));
      if (mode === 'remote' || mode === 'no-selection-proof')
        expect(outcome).toMatchObject({ kind: 'protected_memory_not_saved' });
      expect(alert).not.toHaveBeenCalled();
      const rows = await storage.listSavedGeneratedReportReferences();
      if (mode !== 'selected') {
        expect(rows).toEqual([]);
        if (!modelTools.length) expect(authorize).not.toHaveBeenCalled();
        return;
      }
      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({ remoteProcessing: false }),
      );
      expect(
        await screen.findByText(
          t('savedMemory.generatedReportHealthSummarySectionSaved'),
        ),
      ).toBeTruthy();
      expect(screen.queryByText('Untrusted model prose')).toBeNull();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ reportKind: 'health_summary_section' });
      await view.unmount();
      view = undefined;
      await expectSavedHealthSummarySectionDetail(
        rows[0]!.artifactId,
        section,
        first.summary,
      );
    } finally {
      release();
      await view?.unmount();
      restore();
      AppState.currentState = previousState;
      f.close();
    }
  },
);
