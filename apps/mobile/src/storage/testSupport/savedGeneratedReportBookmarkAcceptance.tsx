import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import { ConversationScreen } from '../../ragConversation/ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../../ragConversation/ConversationSessionsContext';
import { createConversationSessionRetention } from '../../ragConversation/conversationSessionRetention';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { openSavedGeneratedReportReferences } from '../../memory/openSavedGeneratedReportReferences';
import { SavedMemoryDetail } from '../../memory/SavedMemoryDetail';
import type { ConversationArtifact } from '../conversationArtifactTypes';
import type { createConversationArtifactStorage } from '../conversationArtifactStorage';

/** The mounted command uses the real protected bookmark adapter; no provider runs. */
export async function expectReportBookmarkMounted(
  conversations: ReturnType<typeof createConversationArtifactStorage>,
  historical: ConversationArtifact,
) {
  jest
    .mocked(openSavedGeneratedReportReferences)
    .mockResolvedValue(conversations);
  const reader = conversationSavedHistoryDisplayOption(
    async () => conversations,
  );
  expect(
    (await reader(historical.sessionId, 0, new AbortController().signal)).rows,
  ).toMatchObject([{ kind: 'answer', dailyReport: historical.dailyReport }]);
  const appState = Object.getOwnPropertyDescriptor(AppState, 'currentState');
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  const onSend = jest.fn();
  let store!: ReturnType<typeof useConversationSessions>;
  function Capture() {
    store = useConversationSessions();
    return (
      <ConversationScreen
        onSend={onSend}
        onBack={jest.fn()}
        onOpenSource={jest.fn()}
      />
    );
  }

  const view = await render(
    <ConversationSessionsProvider
      options={{
        continuousSession: async () => ({
          id: historical.sessionId,
          version: 0,
          updatedAt: historical.createdAt,
          model: {
            providerId: historical.providerId,
            modelId: historical.modelId,
          },
        }),
        retention: createConversationSessionRetention({
          openStorage: async () => conversations,
          createId: () => 'unused',
          now: () => historical.createdAt,
        }),
        restoreSession: async () => [],
        restoreSessionPage: async () => ({
          turns: [],
          taskCards: [],
          nextCursor: null,
        }),
        readSavedHistoryDisplay: conversationSavedHistoryDisplayOption(
          async () => conversations,
        ),
      }}
    >
      <Capture />
    </ConversationSessionsProvider>,
  );
  try {
    expect(
      await screen.findByText('Synthetic answer based on revision one.'),
    ).toBeTruthy();
    const original = await conversations.read(historical.id);
    expect(original?.dailyReport).toBeDefined();
    const bookmark = jest.spyOn(conversations, 'bookmarkDailyReport');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      await fireEvent.changeText(
        screen.getByTestId('rag-conversation-input'),
        '이 보고서를 기억해줘.',
      );
      const { sessions, activeId } = store.getSnapshot();
      const active = sessions.find(row => row.id === activeId);
      expect({
        lease: store.savedReportLease(activeId),
        archive: active?.savedHistoryDisplay?.map(
          x => x.row.kind === 'answer' && Boolean(x.row.dailyReport),
        ),
        live: active?.messages.map(x => [
          x.role,
          Boolean(x.dailyReport),
          Boolean(x.retainedTurnId),
        ]),
      }).toMatchObject({
        lease: { id: historical.sessionId, version: 0 },
        archive: [true],
      });
      await fireEvent(
        screen.getByTestId('rag-conversation-send'),
        'composerPress',
      );
      await waitFor(() => expect(bookmark).toHaveBeenCalledTimes(1));
      await expect(bookmark.mock.results[0]?.value).resolves.toBe(true);
      await waitFor(() =>
        expect(alert).toHaveBeenCalledWith('보고서 링크를 기억에 보관했어요.'),
      );
      expect(screen.getByTestId('rag-conversation-input').props.value).toBe('');
      await fireEvent.press(
        await screen.findByTestId('conversation-bookmark-generated-report'),
      );
      await waitFor(() =>
        expect(
          screen.getByText('보고서 링크를 기억에 보관했어요.'),
        ).toBeTruthy(),
      );
    } finally {
      alert.mockRestore();
      bookmark.mockRestore();
    }
    expect(onSend).not.toHaveBeenCalled();
    await view.rerender(
      <SavedMemoryDetail
        memoryId={'generated-report:' + historical.id}
        load={async () =>
          (await conversations.listSavedGeneratedReportReferences()).map(
            row => ({
              sourceKind: 'saved_generated_report',
              id: 'generated-report:' + row.artifactId,
              artifactId: row.artifactId,
              text: 'Synthetic report reference',
              createdAt: Date.parse(row.savedAt),
            }),
          )
        }
      />,
    );
    expect(await screen.findByText('AI가 만든 일일 보고서')).toBeTruthy();
    expect(await screen.findByText(/Original report/)).toBeTruthy();
    expect(
      screen.queryByText('Synthetic answer based on revision one.'),
    ).toBeNull();
  } finally {
    await view.unmount();
    if (appState) Object.defineProperty(AppState, 'currentState', appState);
  }
}
