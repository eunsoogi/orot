import { Dimensions, View } from 'react-native';
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
  useNavigationGeometry: () => ({
    hasHinge: true,
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
let hostWidth = 390;
const measurable = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};
let measurement: jest.SpyInstance;
const originalWindow = Dimensions.get('window');
beforeEach(() => {
  hostWidth = 390;
  Dimensions.set({ window: { ...originalWindow, fontScale: 1 } });
  measurement = jest
    .spyOn(measurable.prototype, 'measureInWindow')
    .mockImplementation(callback => callback(0, 0, hostWidth, 800));
});
afterEach(() => {
  measurement.mockRestore();
  Dimensions.set({ window: originalWindow });
});
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
    hostWidth = width;
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
  hostWidth = 1000;
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

test('restored pages retain source access without replaying tool status through reflow', async () => {
  const restored: ConversationSession = {
    ...session,
    busy: false,
    pendingMessage: null,
    requestActivity: null,
    messages: [
      {
        id: -44,
        role: 'assistant',
        restoredHistory: true,
        content: 'Retained answer',
        toolMessageId: 'retained-turn',
        toolEvents: conversationToolEventFixtures,
      },
    ],
  };
  await render(workspace(restored));
  for (const width of [1000, 390, 1000]) {
    hostWidth = width;
    await fireEvent(screen.getByTestId('conversation-workspace'), 'layout', {
      nativeEvent: { layout: { width } },
    });
    expect(
      screen.queryAllByTestId('rag-conversation-tool-events', {
        includeHiddenElements: true,
      }),
    ).toHaveLength(0);
    expect(screen.getByText('Retained answer')).toBeTruthy();
    if (width === 1000)
      expect(
        screen.getByTestId('conversation-retained-tool-sources'),
      ).toBeTruthy();
  }
});

test('a new request exposes live events without reviving restored statuses', async () => {
  hostWidth = 1000;
  await render(
    workspace({
      ...session,
      messages: [
        {
          id: -44,
          role: 'assistant',
          restoredHistory: true,
          content: 'Prior answer',
          toolEvents: conversationToolEventFixtures.map(event => ({
            ...event,
            sources: [],
          })),
        },
      ],
    }),
  );
  const pane = within(screen.getByTestId('conversation-activity-pane'));
  expect(pane.getAllByTestId('rag-conversation-tool-events')).toHaveLength(1);
  expect(pane.queryByTestId('conversation-retained-tool-sources')).toBeNull();
});
