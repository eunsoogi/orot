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

jest.mock('../../navigation/NavigationGeometryProvider', () => ({
  useNavigationGeometry: () => ({ hasHinge: true }),
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
const originalWindow = Dimensions.get('window');
beforeEach(() =>
  Dimensions.set({ window: { ...originalWindow, fontScale: 1 } }),
);
afterEach(() => Dimensions.set({ window: originalWindow }));
const actions = { onOpenSource: jest.fn(), onLinkError: jest.fn() };
const session: ConversationSession = {
  id: 12,
  title: 'Synthetic conversation',
  createdAt: '2026-11-15T00:00:00Z',
  draft: '',
  busy: true,
  error: '',
  messages: [],
  pendingMessage: {
    id: 44,
    content: '',
    activity: '',
    toolEvents: conversationToolEventFixtures,
  },
  requestActivity: { sessionId: 12, requestId: 44, stage: 'waiting' },
};
function workspace(value: ConversationSession) {
  return (
    <ConversationWorkspace session={value} sourceActions={actions}>
      <ConversationHistory
        {...actions}
        messages={value.messages}
        pendingMessage={value.pendingMessage}
        requestSessionId={value.id}
        requestActivity={value.requestActivity}
        error={value.error}
      />
    </ConversationWorkspace>
  );
}
const dots = () =>
  screen.queryAllByTestId('rag-conversation-activity-bubble', {
    includeHiddenElements: true,
  });

// Exercise real workspace context rather than only the visibility predicate.
test('keeps one progress bubble while reflowing and hides it after cancellation', async () => {
  const view = await render(workspace(session));
  for (const width of [390, 1000, 390, 1000]) {
    await fireEvent(screen.getByTestId('conversation-workspace'), 'layout', {
      nativeEvent: { layout: { width } },
    });
    expect(dots()).toHaveLength(1);
    expect(
      within(screen.getByTestId('rag-conversation-history')).queryByTestId(
        'rag-conversation-tool-events',
      ),
    ).toBeNull();
    if (width === 1000) expect(screen.getByText('확인한 자료')).toBeTruthy();
  }
  await view.rerender(
    workspace({
      ...session,
      busy: false,
      pendingMessage: null,
      requestActivity: null,
      error: '취소됐어요.',
    }),
  );
  expect(dots()).toHaveLength(0);
  expect(screen.getByText('취소됐어요.')).toBeTruthy();
});

test('retains progress when expanded streaming text is hidden and clears at completion', async () => {
  const streaming: ConversationSession = {
    ...session,
    pendingMessage: { ...session.pendingMessage!, content: '부분 답변' },
    requestActivity: { sessionId: 12, requestId: 44, stage: 'streaming' },
  };
  const view = await render(workspace(streaming));
  expect(dots()).toHaveLength(0);
  await fireEvent(screen.getByTestId('conversation-workspace'), 'layout', {
    nativeEvent: { layout: { width: 1000 } },
  });
  expect(dots()).toHaveLength(1);
  await view.rerender(
    workspace({
      ...session,
      busy: false,
      pendingMessage: null,
      requestActivity: null,
      messages: [{ id: 44, role: 'assistant', content: '완료 답변' }],
    }),
  );
  expect(dots()).toHaveLength(0);
  expect(screen.getByText('완료 답변')).toBeTruthy();
});
