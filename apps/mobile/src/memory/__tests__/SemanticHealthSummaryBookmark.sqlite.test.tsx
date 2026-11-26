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
import {
  providerSuccess,
  type LanguageModelRequest,
} from '@orot/model-runtime';
import { runRagConversationTurn } from '../../ragConversation/service';
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
      const readback = jest.fn(f.storage.readSavedHealthSummaryReference);
      jest.mocked(openSavedGeneratedReportReferences).mockResolvedValue({
        ...f.storage,
        readSavedHealthSummaryReference: readback,
      });
      const generate = jest.fn(async (request: LanguageModelRequest) => {
        const offered = request.tools?.find(
          tool => tool.name === 'remember-health-summary',
        );
        expect(offered).toBeDefined();
        expect(JSON.stringify(request)).not.toContain(reply.id);
        return providerSuccess({
          text: 'Untrusted model confirmation',
          finishReason: 'tool_calls' as const,
          toolCalls: [
            {
              id: 'semantic-summary-bookmark',
              name: 'remember-health-summary',
              arguments: { target: 'preceding_health_summary' },
            },
          ],
        });
      });
      const authorize = jest.fn(async () => 'authorized' as const);
      const model = { providerId: apple.provider.id, modelId: apple.modelId };
      const selectedAi = async () => ({
        status: 'ready' as const,
        selection: model,
        option: apple,
        provider: {
          ...apple.provider,
          generate,
          capabilities: {
            ...apple.provider.capabilities,
            streaming: false,
            toolCalling: true,
          },
        },
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
      const observedOutcome = jest.fn();
      const run = createRagConversationService({
        selectedAi,
        consent,
        queryConsent: consent,
        externalEvidence: { search },
        registry,
        loadLocalData,
        ragRunner: runRagConversationTurn,
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
          expect(generate).not.toHaveBeenCalled();
          expect(readback).not.toHaveBeenCalled();
          expect(confirmHistorySave).not.toHaveBeenCalled();
        } else {
          await waitFor(() => expect(observedOutcome).toHaveBeenCalledTimes(1));
          expect(observedTarget).toHaveBeenCalledWith(reply.id);
          expect(generate).toHaveBeenCalledTimes(1);
          expect(readback).toHaveBeenCalledWith(reply.id, expect.any(Function));
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
