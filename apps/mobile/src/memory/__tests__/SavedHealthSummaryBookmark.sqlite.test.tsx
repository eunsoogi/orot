import { conversationHealthSummaryBookmarkAction } from '../../aiFeatures/integration/conversationHealthSummaryBookmarkAction';
import { answerMemoryOutcome } from '../../aiFeatures/integration/finishConversationWorkflow';
import type { ConversationScreenProps } from '../../ragConversation/ConversationScreenProps';
import type { ReportBookmarkVisibility } from '../../ragConversation/reportBookmarkOwnership';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AppState } from 'react-native';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { window } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import type {
  ConversationExecutionAdapter,
  ConversationExecutionEvent,
} from '../../ragConversation/conversationExecutionLease';
import { ConversationScreen } from '../../ragConversation/ConversationScreen';
import { ConversationSessionsProvider } from '../../ragConversation/ConversationSessionsContext';
import { createConversationSessionRetention } from '../../ragConversation/conversationSessionRetention';
import { setup } from '../../storage/testSupport/conversationHistoryDisplayFixture';
import { openSavedGeneratedReportReferences } from '../openSavedGeneratedReportReferences';
import { SavedMemoryDetail } from '../SavedMemoryDetail';

jest.mock('../openSavedGeneratedReportReferences');

test.each([
  'visible',
  'tab-round-trip',
  'route-round-trip',
  'native-lock-round-trip',
] as const)(
  'no button is offered, and the remaining model-selected summary save needs a current owner: %s',
  async scenario => {
    const f = await setup();
    const original = AppState.currentState;
    AppState.currentState = 'active';
    try {
      await f.summaryStorage.append(f.saved);
      const reply = await f.save('summary-turn', {
        providerId: f.saved.providerId,
        modelId: f.saved.modelId,
        healthSummary: { summaryId: f.saved.id, window },
      });
      const routeListeners = new Set<() => void>();
      const rootListeners = new Set<(visible: boolean) => void>();
      let visible = true;
      const current: ReportBookmarkVisibility = Object.assign(() => visible, {
        route: {
          isCurrent: () => visible,
          subscribe(listener: () => void) {
            routeListeners.add(listener);
            return () => routeListeners.delete(listener);
          },
        },
        subscribeRoot(listener: (visible: boolean) => void) {
          rootListeners.add(listener);
          return () => rootListeners.delete(listener);
        },
      });
      const nativeListeners = new Set<
        (event: ConversationExecutionEvent) => void
      >();
      const execution: ConversationExecutionAdapter = {
        bridgeAvailable: true,
        currentPhase: () => 'active',
        begin: async () => true,
        isActive: async () => true,
        end: () => {},
        protectedDataAvailable: async () => true,
        subscribe(listener) {
          nativeListeners.add(listener);
          return () => nativeListeners.delete(listener);
        },
      };
      const entered = jest.fn();
      let release!: () => void;
      const hold = new Promise<void>(resolve => {
        release = resolve;
      });
      const settled = jest.fn();
      const opening = jest.mocked(openSavedGeneratedReportReferences);
      opening.mockClear();
      opening.mockResolvedValue({
        ...f.storage,
        async bookmarkHealthSummary(input) {
          entered(input.artifactId);
          await hold;
          const saved = await f.storage.bookmarkHealthSummary(input);
          settled(saved);
          return saved;
        },
      });
      const confirmHistorySave = jest.fn(async () => true);
      const send = jest.fn<
        ReturnType<ConversationScreenProps['onSend']>,
        Parameters<ConversationScreenProps['onSend']>
      >(async (_question, _history, signal, observer) => {
        // Synthetic model selection only. Use the exact live target, production
        // consent/action implementation, and the original protected writer.
        const bookmark = conversationHealthSummaryBookmarkAction({
          ...observer,
          confirmHistorySave,
        });
        const action = bookmark.actions.find(
          tool => tool.id === 'remember-health-summary',
        );
        if (!signal || !action) throw new Error('Missing exact summary owner.');
        const input = { target: 'preceding_health_summary' };
        if (!(await action.authorize(input, signal)))
          throw new Error('Missing exact summary decision.');
        try {
          await action.execute({
            input,
            signal,
            operationRunId: 'synthetic',
            operationKey: 'tool-1',
          });
        } catch {
          return { status: 'failure', kind: 'unavailable' };
        }
        return answerMemoryOutcome(
          {
            status: 'answer',
            answer: 'Untrusted synthetic text',
            citations: [],
          },
          bookmark.committed() ? 'generated-report' : 'not_attempted',
        );
      });
      const view = await render(
        <ConversationSessionsProvider
          options={{
            execution,
            continuousSession: async () => ({
              id: reply.sessionId,
              version: 0,
              updatedAt: reply.createdAt,
              model: { providerId: reply.providerId, modelId: reply.modelId },
            }),
            retention: createConversationSessionRetention({
              openStorage: async () => f.storage,
              createId: () => 'unused',
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
            isEntryCurrent={current}
            onSend={send}
            onBack={jest.fn()}
            onOpenSource={jest.fn()}
          />
        </ConversationSessionsProvider>,
      );
      try {
        expect(await screen.findByTestId('health-summary-card')).toBeTruthy();
        expect(
          screen.queryByRole('button', {
            name: '원본 건강 정보 요약을 기억에 보관하기',
          }),
        ).toBeNull();
        expect(opening).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
        expect(await f.storage.listSavedGeneratedReportReferences()).toEqual(
          [],
        );
        await fireEvent.changeText(
          screen.getByTestId('rag-conversation-input'),
          '이 건강 정보 요약을 기억해줘.',
        );
        await fireEvent.press(screen.getByTestId('rag-conversation-send'));
        await waitFor(() => expect(entered).toHaveBeenCalledWith(reply.id));
        expect(confirmHistorySave).toHaveBeenCalledTimes(1);
        await act(async () => {
          if (scenario === 'native-lock-round-trip') {
            expect(nativeListeners.size).toBeGreaterThan(0);
            for (const available of [false, true])
              for (const listener of [...nativeListeners])
                listener({ kind: 'protectedData', available });
          } else if (scenario !== 'visible') {
            for (const next of [false, true]) {
              visible = next;
              if (scenario === 'tab-round-trip')
                for (const listener of [...rootListeners]) listener(next);
              else for (const listener of [...routeListeners]) listener();
            }
          }
        });
        release();
        if (scenario !== 'visible') {
          await waitFor(() => expect(settled).toHaveBeenCalledWith(false));
          expect(await f.storage.listSavedGeneratedReportReferences()).toEqual(
            [],
          );
          expect(send).toHaveBeenCalledTimes(1);
          expect(
            screen.queryByText('보고서 링크를 기억에 보관했어요.'),
          ).toBeNull();
          return;
        }
        expect(
          await screen.findByText('보고서 링크를 기억에 보관했어요.'),
        ).toBeTruthy();
        expect(send).toHaveBeenCalledTimes(1);
        await view.rerender(
          <SavedMemoryDetail
            memoryId={'generated-report:' + reply.id}
            load={async () =>
              (await f.storage.listSavedGeneratedReportReferences()).map(
                row => ({
                  sourceKind: 'saved_generated_report',
                  id: 'generated-report:' + row.artifactId,
                  artifactId: row.artifactId,
                  reportKind: row.reportKind,
                  text: 'Synthetic report reference',
                  createdAt: Date.parse(row.savedAt),
                }),
              )
            }
          />,
        );
        expect(
          await screen.findByText('AI가 만든 건강 정보 요약'),
        ).toBeTruthy();
        expect(
          await screen.findByText(f.saved.analysis.hypotheses[0]!.summary),
        ).toBeTruthy();
        expect(screen.queryByText(reply.answer)).toBeNull();
      } finally {
        release();
        await view.unmount();
      }
    } finally {
      AppState.currentState = original;
      f.close();
    }
  },
  20000,
);
