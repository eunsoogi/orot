import type { ReportBookmarkVisibility } from '../../ragConversation/reportBookmarkOwnership';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AppState } from 'react-native';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { window } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { ConversationScreen } from '../../ragConversation/ConversationScreen';
import { ConversationSessionsProvider } from '../../ragConversation/ConversationSessionsContext';
import { createConversationSessionRetention } from '../../ragConversation/conversationSessionRetention';
import { setup } from '../../storage/testSupport/conversationHistoryDisplayFixture';
import { openSavedGeneratedReportReferences } from '../openSavedGeneratedReportReferences';
import { SavedMemoryDetail } from '../SavedMemoryDetail';

jest.mock('../openSavedGeneratedReportReferences');

test.each(['visible', 'tab-round-trip', 'route-round-trip'] as const)(
  'a mounted summary writes only while its exact local owner remains current: %s',
  async scenario => {
    const f = await setup();
    const original = Object.getOwnPropertyDescriptor(AppState, 'currentState');
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: 'active',
    });
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
      let entered!: () => void;
      let release!: () => void;
      const started = new Promise<void>(resolve => {
        entered = resolve;
      });
      const hold = new Promise<void>(resolve => {
        release = resolve;
      });
      const settled = jest.fn();
      const opening = jest.mocked(openSavedGeneratedReportReferences);
      opening.mockResolvedValue({
        ...f.storage,
        async bookmarkHealthSummary(input) {
          entered();
          await hold;
          const saved = await f.storage.bookmarkHealthSummary(input);
          settled(saved);
          return saved;
        },
      });
      const send = jest.fn();
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
        const action = await screen.findByRole('button', {
          name: '원본 건강 정보 요약을 기억에 보관하기',
        });
        expect(await f.storage.listSavedGeneratedReportReferences()).toEqual(
          [],
        );
        await fireEvent.press(action);
        await started;
        if (scenario !== 'visible') {
          for (const next of [false, true]) {
            visible = next;
            if (scenario === 'tab-round-trip')
              for (const listener of [...rootListeners]) listener(next);
            else for (const listener of [...routeListeners]) listener();
          }
        }
        release();
        if (scenario !== 'visible') {
          await waitFor(() => expect(settled).toHaveBeenCalledWith(false));
          expect(await f.storage.listSavedGeneratedReportReferences()).toEqual(
            [],
          );
          expect(send).not.toHaveBeenCalled();
          return;
        }
        expect(
          await screen.findByText('보고서 링크를 기억에 보관했어요.'),
        ).toBeTruthy();
        expect(send).not.toHaveBeenCalled();
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
      if (original) Object.defineProperty(AppState, 'currentState', original);
      f.close();
    }
  },
  20000,
);
