import { ConversationScreen } from '../ConversationScreen';
import { Dimensions } from 'react-native';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { ConversationWorkspace } from '../ConversationWorkspace';
import { ConversationHistory } from '../ConversationHistory';
import type { ConversationSession } from '../conversationSessionTypes';
import { conversationToolEventFixtures } from '../testSupport/conversationToolEventFixtures';
import { conversationWorkspaceLayout } from '../conversationWorkspaceLayout';

let mockHinge = true;
jest.mock('../../navigation/NavigationGeometryProvider', () => ({
  useNavigationGeometry: () => ({
    hasHinge: mockHinge,
    reservedRegions: [],
    usableRegions: [],
    safeAreaFrame: { x: 0, y: 0, width: 1000, height: 800 },
  }),
}));
jest.mock('../../assistantAppearance/AssistantAppearanceProvider', () => ({
  useAssistantAppearance: () => ({ ready: true }),
}));
jest.mock('../../assistantAppearance/AssistantHeader', () => ({
  AssistantHeader: () => null,
  activityLabel: () => '답변을 작성하고 있어요.',
}));
jest.mock('../../assistantAppearance/FloatingProfileGradient', () => ({
  FloatingProfileGradient: () => null,
}));

const session: ConversationSession = {
  id: 1,
  title: '합성 대화',
  createdAt: '2026-11-14T00:00:00Z',
  draft: '',
  busy: true,
  error: '',
  messages: [
    { id: 1, role: 'user', content: '합성 질문' },
    {
      id: 2,
      role: 'assistant',
      content: '완료한 답변',
      toolEvents: conversationToolEventFixtures,
    },
  ],
  pendingMessage: { id: 3, content: '작성 중 텍스트', activity: '작성 중' },
};
const actions = { onOpenSource: jest.fn(), onLinkError: jest.fn() };
function Workspace() {
  return (
    <ConversationWorkspace session={session} sourceActions={actions}>
      <ConversationHistory
        {...actions}
        messages={session.messages}
        pendingMessage={session.pendingMessage}
        error="다시 시도할 수 있어요."
      />
    </ConversationWorkspace>
  );
}

const originalWindow = Dimensions.get('window');
beforeEach(() => {
  mockHinge = true;
  Dimensions.set({ window: { ...originalWindow, fontScale: 1 } });
});
afterEach(() => Dimensions.set({ window: originalWindow }));
test.each([
  [false, 1200, 1, false],
  [true, 390, 1, false],
  [true, 759, 1, false],
  [true, 760, 1, true],
  [true, 900, 1.4, false],
  [true, NaN, 1, false],
])(
  'requires native capability and readable measured space (%s %s %s)',
  (hinge, width, scale, visible) => {
    expect(conversationWorkspaceLayout(hinge, width, scale).visible).toBe(
      visible,
    );
  },
);

test('reflows activity and identity without remounting transcript or losing errors', async () => {
  await render(<Workspace />);
  const history = screen.getByTestId('rag-conversation-history');
  expect(screen.queryByTestId('conversation-activity-pane')).toBeNull();
  expect(within(history).getByText('작성 중 텍스트')).toBeTruthy();
  expect(
    within(history).queryByTestId('rag-conversation-tool-events'),
  ).toBeNull();
  await fireEvent(screen.getByTestId('conversation-workspace'), 'layout', {
    nativeEvent: { layout: { width: 1000 } },
  });
  expect(screen.getByTestId('rag-conversation-history')).toBe(history);
  expect(screen.getByTestId('assistant-floating-overlay')).toHaveStyle({
    width: 320,
  });
  expect(within(history).queryByText('작성 중 텍스트')).toBeNull();
  expect(within(history).getByText('완료한 답변')).toBeTruthy();
  expect(within(history).getByText('합성 질문')).toBeTruthy();
  expect(within(history).getByText('다시 시도할 수 있어요.')).toBeTruthy();
  expect(
    within(history).queryByTestId('rag-conversation-tool-events'),
  ).toBeNull();
  const pane = screen.getByTestId('conversation-activity-pane');
  expect(within(pane).getByTestId('rag-conversation-tool-events')).toBeTruthy();
  await fireEvent.press(within(pane).getByTestId('rag-tool-group-toggle'));
  const tool = within(pane).getByTestId(
    'rag-tool-event-synthetic-run-tool-1-toggle',
  );
  await fireEvent.press(tool);
  expect(tool.props.accessibilityState.expanded).toBe(true);
  await fireEvent(screen.getByTestId('conversation-workspace'), 'layout', {
    nativeEvent: { layout: { width: 390 } },
  });
  expect(screen.getByTestId('rag-conversation-history')).toBe(history);
  expect(screen.queryByTestId('conversation-activity-pane')).toBeNull();
  expect(within(history).getByText('작성 중 텍스트')).toBeTruthy();
  expect(
    within(history).queryByTestId('rag-conversation-tool-events'),
  ).toBeNull();
  await fireEvent(screen.getByTestId('conversation-workspace'), 'layout', {
    nativeEvent: { layout: { width: 1000 } },
  });
  expect(
    screen.getByTestId('rag-tool-event-synthetic-run-tool-1-toggle').props
      .accessibilityState.expanded,
  ).toBe(true);
});

test('does not enable the pane on an ordinary wide phone', async () => {
  mockHinge = false;
  await render(<Workspace />);
  await fireEvent(screen.getByTestId('conversation-workspace'), 'layout', {
    nativeEvent: { layout: { width: 1100 } },
  });
  expect(screen.queryByTestId('conversation-activity-pane')).toBeNull();
  expect(screen.getByText('작성 중 텍스트')).toBeTruthy();
  expect(screen.queryByTestId('rag-conversation-tool-events')).toBeNull();
});

test('keeps the live request and draft when the Duo pane folds and expands', async () => {
  const onSend = jest.fn<Promise<never>, [string, unknown, AbortSignal?]>(
    () => new Promise<never>(() => {}),
  );
  await render(
    <ConversationScreen
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
      onSend={onSend}
    />,
  );
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '합성 요청',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '다음 질문 초안',
  );
  const input = screen.getByTestId('rag-conversation-input');
  for (const width of [1000, 390, 1000]) {
    await fireEvent(screen.getByTestId('conversation-workspace'), 'layout', {
      nativeEvent: { layout: { width } },
    });
    expect(screen.getByTestId('rag-conversation-input')).toBe(input);
    expect(input.props.value).toBe('다음 질문 초안');
    expect(screen.getByTestId('rag-conversation-cancel')).toBeTruthy();
  }
  expect(onSend).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('rag-conversation-cancel'));
  expect(onSend.mock.calls[0]?.[2]?.aborted).toBe(true);
});
