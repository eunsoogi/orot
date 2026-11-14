import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ConversationHistoryScreen } from '../ConversationHistoryScreen';
import * as sessionsContext from '../ConversationSessionsContext';
import { createConversationSessions } from '../conversationSessions';

interface TestTreeNode {
  readonly parent: TestTreeNode | null;
  readonly children: readonly TestTreeNode[];
  readonly props: { readonly testID?: string };
}

function directChildOf(
  parent: TestTreeNode,
  descendant: TestTreeNode,
): TestTreeNode {
  let current = descendant;
  while (current.parent && current.parent !== parent) current = current.parent;
  return current;
}

test('keeps the page heading and new-session action inside the single history scroll', async () => {
  const store = createConversationSessions();
  const onBack = jest.fn();
  const sessionHook = jest
    .spyOn(sessionsContext, 'useConversationSessions')
    .mockReturnValue(store);
  try {
    await render(<ConversationHistoryScreen onBack={onBack} />);
    const list = screen.getByTestId('conversation-history-list');
    expect(
      within(screen.getByTestId('conversation-history-page')).getByTestId(
        'conversation-history-list',
      ),
    ).toBeTruthy();
    await fireEvent(list, 'contentHeightChange', {
      nativeEvent: { height: 640 },
    });
    expect(StyleSheet.flatten(list.props.style).height).toBe(640);
    expect(
      screen.getByTestId('conversation-history-title').props,
    ).toMatchObject({
      accessibilityRole: 'header',
      children: '대화 기록',
    });
    expect(
      screen.getByTestId('conversation-history-count').props.children,
    ).toBe('1개의 대화');
    await fireEvent.press(screen.getByTestId('conversation-history-new'));
    expect(store.getSnapshot().sessions).toHaveLength(2);
    expect(onBack).toHaveBeenCalledTimes(1);
  } finally {
    sessionHook.mockRestore();
    store.dispose();
  }
});

test('places the title and count before available saved outputs and the session list', async () => {
  const store = createConversationSessions();
  store.create();
  const onBack = jest.fn();
  const onOpenSavedAnalysis = jest.fn();
  const onOpenSavedVisitQuestions = jest.fn();
  const sessionHook = jest
    .spyOn(sessionsContext, 'useConversationSessions')
    .mockReturnValue(store);
  try {
    await render(
      <ConversationHistoryScreen
        onBack={onBack}
        onOpenSavedAnalysis={onOpenSavedAnalysis}
        onOpenSavedVisitQuestions={onOpenSavedVisitQuestions}
      />,
    );
    const pane = screen.getByTestId('conversation-history-pane');
    const header = within(pane).getByTestId('conversation-history-header');
    const titleRow = within(header).getByTestId(
      'conversation-history-title-row',
    );
    const title = within(titleRow).getByTestId('conversation-history-title');
    const count = within(header).getByTestId('conversation-history-count');
    const savedOutputs = within(header).getByTestId(
      'conversation-history-saved-outputs',
    );
    expect(titleRow.parent).toBe(header);
    expect(count.parent).toBe(header);
    expect(savedOutputs.parent).toBe(header);
    expect(header.children.indexOf(titleRow)).toBeLessThan(
      header.children.indexOf(count),
    );
    expect(header.children.indexOf(count)).toBeLessThan(
      header.children.indexOf(savedOutputs),
    );
    expect(title.props).toMatchObject({
      accessibilityRole: 'header',
      children: '대화 기록',
    });
    expect(count.props.children).toBe('2개의 대화');
    expect(within(savedOutputs).getByText('저장된 AI 결과')).toBeTruthy();
    const savedAnalysis = within(savedOutputs).getByTestId(
      'conversation-saved-analysis',
    );
    const savedVisitQuestions = within(savedOutputs).getByTestId(
      'conversation-saved-visit-questions',
    );
    expect(savedAnalysis.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityHint: expect.stringContaining('새 AI 요청'),
    });
    expect(savedVisitQuestions.props.accessibilityRole).toBe('button');

    const list = within(pane).getByTestId('conversation-history-list');
    const listSection = directChildOf(
      pane as TestTreeNode,
      list as TestTreeNode,
    );
    expect(pane.children.indexOf(header)).toBeLessThan(
      pane.children.indexOf(listSection as (typeof pane.children)[number]),
    );
    await fireEvent.press(savedAnalysis);
    await fireEvent.press(savedVisitQuestions);
    expect(onOpenSavedAnalysis).toHaveBeenCalledTimes(1);
    expect(onOpenSavedVisitQuestions).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().sessions).toHaveLength(2);
    expect(onBack).not.toHaveBeenCalled();
  } finally {
    sessionHook.mockRestore();
    store.dispose();
  }
});

test('omits saved output shortcuts when their routes are unavailable', async () => {
  const store = createConversationSessions();
  const sessionHook = jest
    .spyOn(sessionsContext, 'useConversationSessions')
    .mockReturnValue(store);
  try {
    await render(
      <ConversationHistoryScreen
        onBack={jest.fn()}
        onOpenSavedAnalysis={jest.fn()}
      />,
    );
    const savedOutputs = screen.getByTestId(
      'conversation-history-saved-outputs',
    );
    expect(
      within(savedOutputs).getByTestId('conversation-saved-analysis'),
    ).toBeTruthy();
    expect(
      within(savedOutputs).queryByTestId('conversation-saved-visit-questions'),
    ).toBeNull();
  } finally {
    sessionHook.mockRestore();
    store.dispose();
  }
});

/** Native visual checks cover actual clipping; this protects wrapping and the real undo action. */
test('lets deletion feedback wrap and restores the removed session', async () => {
  const store = createConversationSessions();
  store.create();
  store.remove(1);
  const sessionHook = jest
    .spyOn(sessionsContext, 'useConversationSessions')
    .mockReturnValue(store);
  try {
    await render(<ConversationHistoryScreen onBack={jest.fn()} />);
    const feedback = screen.getByText('대화를 삭제했어요.');
    expect(StyleSheet.flatten(feedback.parent?.props.style)).toMatchObject({
      flexWrap: 'wrap',
    });
    await fireEvent.press(screen.getByTestId('conversation-history-undo'));
    expect(store.getSnapshot().sessions.map(session => session.id)).toEqual([
      1, 2,
    ]);
    expect(screen.queryByText('대화를 삭제했어요.')).toBeNull();
  } finally {
    sessionHook.mockRestore();
    store.dispose();
  }
});

test('keeps restore recovery after the header inside the page and preserves rows across retries', async () => {
  const store = createConversationSessions();
  const restore = jest
    .spyOn(store, 'loadHistory')
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(undefined);
  const hook = jest
    .spyOn(sessionsContext, 'useConversationSessions')
    .mockReturnValue(store);
  try {
    await render(<ConversationHistoryScreen onBack={jest.fn()} />);
    const page = screen.getByTestId('conversation-history-page');
    const pane = within(page).getByTestId('conversation-history-pane');
    const header = within(pane).getByTestId('conversation-history-header');
    const recovery = await screen.findByTestId('conversation-history-recovery');
    expect(within(pane).getByTestId('conversation-history-recovery')).toBe(
      recovery,
    );
    expect(pane.children.indexOf(header)).toBeLessThan(
      pane.children.indexOf(recovery),
    );
    expect(StyleSheet.flatten(recovery.props.style)).toMatchObject({
      marginHorizontal: 24,
    });
    const initialRows = screen.getByTestId('conversation-history-list').props
      .rows;
    await fireEvent.press(screen.getByTestId('conversation-history-retry'));
    expect(
      await screen.findByTestId('conversation-history-recovery'),
    ).toBeTruthy();
    expect(screen.getByTestId('conversation-history-list').props.rows).toEqual(
      initialRows,
    );
    await fireEvent.press(screen.getByTestId('conversation-history-retry'));
    expect(screen.queryByTestId('conversation-history-recovery')).toBeNull();
    expect(screen.getByTestId('conversation-history-list').props.rows).toEqual(
      initialRows,
    );
    expect(restore).toHaveBeenCalledTimes(3);
  } finally {
    hook.mockRestore();
    restore.mockRestore();
    store.dispose();
  }
});
