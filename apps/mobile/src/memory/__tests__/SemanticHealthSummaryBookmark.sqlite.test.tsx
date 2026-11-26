import { createConversationSummaryIntegration } from '../../aiFeatures/integration/conversationSummaryIntegration';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { window } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createRagConversationService } from '../../aiFeatures/integration/ragConversationService';
import {
  apple,
  localData,
} from '../../aiFeatures/integration/featureServiceFixtures';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { installReceiptFixturePlatform } from '../../aiFeatures/integration/testSupport/conversationReceiptFixturePlatform';
import { ConversationScreen } from '../../ragConversation/ConversationScreen';
import { ConversationSessionsProvider } from '../../ragConversation/ConversationSessionsContext';
import { createConversationSessionRetention } from '../../ragConversation/conversationSessionRetention';
import { setup } from '../../storage/testSupport/conversationHistoryDisplayFixture';
import { openSavedGeneratedReportReferences } from '../openSavedGeneratedReportReferences';

jest.mock('../openSavedGeneratedReportReferences');

test.each(['contextual', 'exact-local'] as const)(
  'saves the completed Health Summary, never user-authored memory: %s',
  async mode => {
    const f = await setup();
    const before = AppState.currentState;
    AppState.currentState = 'active';
    const restore = installReceiptFixturePlatform(() => {});
    const confirmHistorySave = jest.fn(async () => true);
    const search = jest.fn();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      const summary = {
        ...f.saved,
        providerId: apple.provider.id,
        modelId: apple.modelId,
      };
      await f.summaryStorage.append(summary);
      const reply = await f.save('synthetic-summary-turn', {
        providerId: summary.providerId,
        modelId: summary.modelId,
        healthSummary: { summaryId: summary.id, window },
      });
      const retained = jest.mocked(openSavedGeneratedReportReferences);
      retained.mockResolvedValue(f.storage);
      const authorize = jest.fn(async () => 'authorized' as const);
      const model = { providerId: apple.provider.id, modelId: apple.modelId };
      const selectedAi = async () => ({
        status: 'ready' as const,
        selection: model,
        option: apple,
        provider: apple.provider,
        modelId: apple.modelId,
        recipient: 'Synthetic device',
        remoteProcessing: false,
      });
      const registry = new LocalEvidenceReferenceRegistry();
      const loadLocalData = async () => ({
        ...localData([]).data,
        openConversationArtifactStorage: async () => f.storage,
      });
      const consent = { authorize };
      const observedTarget = jest.fn();
      const observedExecution = jest.fn();
      const observedOutcome = jest.fn();
      const run = createRagConversationService({
        selectedAi,
        consent,
        queryConsent: consent,
        externalEvidence: { search },
        registry,
        loadLocalData,
        async ragRunner(options, invocation) {
          const action = options.workflow.actions?.find(
            item => item.id === 'remember-health-summary',
          );
          const signal = invocation?.signal;
          observedExecution(
            action ? 'offered' : 'not offered',
            Boolean(signal),
          );
          if (!action || !signal)
            throw new Error('Local summary action is unavailable.');
          const input = { target: 'preceding_health_summary' };
          expect(
            action.parseInput({ ...input, artifactId: 'untrusted' }),
          ).toBeUndefined();
          const authorized = await action.authorize(input, signal);
          observedExecution(authorized ? 'authorized' : 'not authorized');
          expect(authorized).toBe(true);
          await action.execute({
            input,
            signal,
            operationRunId: 'synthetic-run',
            operationKey: 'synthetic-action',
          });
          observedExecution('executed');
          return {
            status: 'answer',
            answer: 'Untrusted model confirmation',
            citations: [],
          };
        },
      });
      const { sendRagMessage } = createConversationSummaryIntegration({
        consent,
        dependencies: {},
        selectedAi,
        registry,
        loadData: loadLocalData,
        diseaseRunner: jest.fn(),
        sendRagMessage: run,
        loadSavedVisitQuestions: jest.fn(),
      });
      const view = await render(
        <ConversationSessionsProvider
          options={{
            continuousSession: async () => ({
              id: reply.sessionId,
              version: 0,
              updatedAt: reply.createdAt,
              model: { providerId: reply.providerId, modelId: reply.modelId },
            }),
            retention: createConversationSessionRetention({
              openStorage: async () => f.storage,
              createId: () => 'synthetic-typed-request',
              now: () => reply.createdAt,
            }),
            restoreSession: async () => [],
            restoreSessionPage: async () => ({
              turns: [],
              taskCards: [],
              nextCursor: null,
            }),
            readSavedHistoryDisplay: conversationSavedHistoryDisplayOption(
              async () => f.storage,
            ),
          }}
        >
          <ConversationScreen
            onSend={async (question, history, signal, observer, context) => {
              observedTarget(observer?.reportBookmark?.artifactId);
              const outcome = await sendRagMessage(
                question,
                history,
                signal,
                {
                  ...observer,
                  confirmHistorySave,
                  suppressContextualOpening: true,
                  expectedConversationModel: model,
                },
                context,
              );
              observedOutcome(outcome);
              return outcome;
            }}
            onBack={jest.fn()}
            onOpenSource={jest.fn()}
          />
        </ConversationSessionsProvider>,
      );
      try {
        await screen.findByTestId('health-summary-card');
        expect(
          screen.queryByTestId('conversation-bookmark-generated-report'),
        ).toBeNull();
        await fireEvent.changeText(
          screen.getByTestId('rag-conversation-input'),
          mode === 'contextual'
            ? '이 건강 정보 요약을 기억해줘.'
            : '이 보고서를 기억해줘.',
        );
        await fireEvent.press(screen.getByTestId('rag-conversation-send'));
        if (mode === 'exact-local') {
          await waitFor(() =>
            expect(alert).toHaveBeenCalledWith(
              '보고서 링크를 기억에 보관했어요.',
            ),
          );
          expect(observedTarget).not.toHaveBeenCalled();
          expect(observedExecution).not.toHaveBeenCalled();
          expect(confirmHistorySave).not.toHaveBeenCalled();
        } else {
          await waitFor(() => expect(observedOutcome).toHaveBeenCalledTimes(1));
          expect(observedTarget).toHaveBeenCalledWith(reply.id);
          expect(observedExecution.mock.calls).toEqual([
            ['offered', true],
            ['authorized'],
            ['executed'],
          ]);
          expect(observedOutcome).toHaveBeenCalledWith(
            expect.objectContaining({
              status: 'answer',
              committedAnswerMemory: true,
            }),
          );
          expect(
            await screen.findByText('보고서 링크를 기억에 보관했어요.'),
          ).toBeTruthy();
          expect(screen.queryByText('Untrusted model confirmation')).toBeNull();
          expect(confirmHistorySave).toHaveBeenCalledTimes(1);
        }
        expect(search).not.toHaveBeenCalled();
        expect(
          await f.storage.listSavedGeneratedReportReferences(),
        ).toMatchObject([
          { artifactId: reply.id, reportKind: 'health_summary' },
        ]);
      } finally {
        await view.unmount();
      }
    } finally {
      restore();
      AppState.currentState = before;
      alert.mockRestore();
      f.close();
    }
  },
  20000,
);
