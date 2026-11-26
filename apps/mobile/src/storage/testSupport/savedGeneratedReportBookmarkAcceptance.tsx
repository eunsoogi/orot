import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import { runDailyReportBookmarkGraphFixture } from './runDailyReportBookmarkGraphFixture';
import { ConversationScreen } from '../../ragConversation/ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../../ragConversation/ConversationSessionsContext';
import { createConversationSessionRetention } from '../../ragConversation/conversationSessionRetention';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { openSavedGeneratedReportReferences } from '../../memory/openSavedGeneratedReportReferences';
import { SavedMemoryDetail } from '../../memory/SavedMemoryDetail';
import {
  exerciseColdDailyReportBookmarkTap,
  isolatedColdDailyBookmark,
  expectColdDailyReportOwner,
} from './coldDailyReportBookmarkTap';
import type { ConversationArtifact } from '../conversationArtifactTypes';
import type { createConversationArtifactStorage } from '../conversationArtifactStorage';

/** The mounted command uses the real protected bookmark adapter; no provider runs. */
export async function expectReportBookmarkMounted(
  conversations: ReturnType<typeof createConversationArtifactStorage>,
  historical: ConversationArtifact,
  mode: 'tap' | 'explicit-local' | 'semantic',
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
  if (mode === 'tap') {
    const displayedReport = {
      runId: historical.dailyReport!.runId,
      revision: historical.dailyReport!.revision,
      identityKey: historical.dailyReport!.identity.key,
    };
    for (const drift of [
      { runId: 'other-report' },
      { revision: 2 },
      { identityKey: 'different-period' },
    ])
      expect(
        await conversations.bookmarkDailyReport({
          artifactId: historical.id,
          lease: { id: historical.sessionId, version: 0 },
          current: () => true,
          displayedReport: { ...displayedReport, ...drift },
        }),
      ).toBe(false);
  }
  const appState = Object.getOwnPropertyDescriptor(AppState, 'currentState');
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  const confirm = jest.fn(async () => true);
  const onSend = jest.fn<
    ReturnType<React.ComponentProps<typeof ConversationScreen>['onSend']>,
    Parameters<React.ComponentProps<typeof ConversationScreen>['onSend']>
  >(async (_question, _history, signal, observer) => {
    if (!observer || !signal) throw new Error('Owned Composer turn is missing');
    expect(observer.reportBookmark?.artifactId).toBe(historical.id);
    await runDailyReportBookmarkGraphFixture(observer, confirm, signal);
    return {
      status: 'answer',
      answer: 'Synthetic committed receipt',
      citations: [],
    };
  });
  let store!: ReturnType<typeof useConversationSessions>;
  let showIsolatedTap = false;
  function Capture() {
    store = useConversationSessions();
    return (
      <>
        <ConversationScreen
          onSend={onSend}
          onBack={jest.fn()}
          onOpenSource={jest.fn()}
        />
        {showIsolatedTap &&
          isolatedColdDailyBookmark(store.getSnapshot().activeId, historical)}
      </>
    );
  }

  const tree = () => (
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
    </ConversationSessionsProvider>
  );
  const view = await render(tree());
  try {
    expect(
      await screen.findByText('Synthetic answer based on revision one.'),
    ).toBeTruthy();
    expect(
      screen.queryByTestId('conversation-bookmark-generated-report'),
    ).toBeNull();
    expect(
      screen.queryByTestId('conversation-bookmark-daily-report'),
    ).toBeNull();
    expect(await conversations.listSavedGeneratedReportReferences()).toEqual(
      [],
    );
    const original = await conversations.read(historical.id);
    expect(original?.dailyReport).toBeDefined();
    const bookmark = jest.spyOn(conversations, 'bookmarkDailyReport');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      if (mode === 'tap') {
        // Exercise the isolated archived lease without reviving the production transcript button.
        showIsolatedTap = true;
        await view.rerender(tree());
        await exerciseColdDailyReportBookmarkTap(
          conversations,
          historical,
          bookmark,
        );
        expect(
          await screen.findByText('보고서 링크를 기억에 보관했어요.'),
        ).toBeTruthy();
        showIsolatedTap = false;
        await view.rerender(tree());
      } else {
        await fireEvent.changeText(
          screen.getByTestId('rag-conversation-input'),
          mode === 'semantic'
            ? '방금 본 일일 보고서를 나중에 다시 열 수 있게 보관해 줄래?'
            : '이 보고서를 기억해줘.',
        );
        expectColdDailyReportOwner(store, historical.sessionId);
        await fireEvent(
          screen.getByTestId('rag-conversation-send'),
          'composerPress',
        );
      }
      await waitFor(() => expect(bookmark).toHaveBeenCalledTimes(1));
      await expect(bookmark.mock.results[0]?.value).resolves.toBe(true);
      if (mode === 'semantic')
        expect(
          await screen.findByText('Synthetic committed receipt'),
        ).toBeTruthy();
      else if (mode !== 'tap')
        await waitFor(() =>
          expect(alert).toHaveBeenCalledWith(
            '보고서 링크를 기억에 보관했어요.',
          ),
        );
      expect(screen.getByTestId('rag-conversation-input').props.value).toBe('');
    } finally {
      alert.mockRestore();
      bookmark.mockRestore();
    }
    expect(onSend).toHaveBeenCalledTimes(mode === 'semantic' ? 1 : 0);
    expect(confirm).toHaveBeenCalledTimes(mode === 'semantic' ? 1 : 0);
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
