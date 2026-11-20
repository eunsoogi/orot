import type { ComponentProps, ReactElement } from 'react';
import { render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, type TextProps } from 'react-native';

jest.mock('../../layout/AiResponseText', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return {
    AiResponseText: (props: TextProps): ReactElement =>
      React.createElement(Text, props, props.children),
  };
});

import { ConversationHistory } from '../ConversationHistory';
import { ConversationHistoryPreview } from '../ConversationHistoryPreview';
import { createEmptyConversation } from '../conversationEmptySession';
import type { ConversationActivitySnapshot } from '../conversationActivity';
import { conversationToolEventFixtures } from '../testSupport/conversationToolEventFixtures';

beforeEach(() => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

const callbacks = {
  error: '',
  onOpenSource: jest.fn(),
  onLinkError: jest.fn(),
};

function activity(
  stage: ConversationActivitySnapshot['stage'],
  sessionId = 12,
): ConversationActivitySnapshot {
  return { sessionId, requestId: 44, userMessageId: 43, stage };
}

const sent = {
  submittedAt: '2026-11-20T00:00:00.000Z',
  acceptedAt: '2026-11-20T00:00:01.000Z',
};
const user = {
  id: 43,
  role: 'user' as const,
  content: '현재 질문',
  delivery: { ...sent, readAt: '2026-11-20T00:00:02.000Z' },
};

function history(props: Partial<ComponentProps<typeof ConversationHistory>>) {
  return (
    <ConversationHistory
      {...callbacks}
      messages={[user]}
      pendingMessage={null}
      {...props}
    />
  );
}

test('shows reply dots only after the owning user receipt is Read', async () => {
  const previous = { ...user, id: 40, content: '이전 질문' };
  const pending = { id: 44, content: '', activity: '답변 준비 중' };
  const view = await render(
    history({
      requestSessionId: 12,
      requestActivity: activity('preparing'),
      pendingMessage: pending,
      messages: [
        previous,
        {
          ...user,
          delivery: { submittedAt: sent.submittedAt },
          deliveryPending: true,
        },
      ],
    }),
  );

  const dots = () =>
    screen.queryByTestId('rag-conversation-activity-bubble', {
      includeHiddenElements: true,
    });
  const receipt = () =>
    screen.getAllByTestId('conversation-message-receipt')[1];
  expect(receipt()).not.toHaveTextContent(/읽음/);
  expect(dots()).toBeNull();

  await view.rerender(
    history({
      requestSessionId: 12,
      requestActivity: { ...activity('waiting'), responseStarted: true },
      pendingMessage: {
        ...pending,
        initialResponse: { callId: 'pending', text: '…', source: 'receipt' },
      },
      messages: [previous, { ...user, delivery: sent }],
    }),
  );
  expect(receipt()).toHaveTextContent(/보냄/);
  expect(dots()).toBeNull();
  expect(screen.queryByTestId('conversation-assistant-message')).toBeNull();

  await view.rerender(
    history({
      requestSessionId: 12,
      requestActivity: activity('waiting'),
      pendingMessage: pending,
      messages: [previous, user],
    }),
  );
  expect(receipt()).toHaveTextContent(/읽음/);
  expect(dots()).toBeTruthy();
});

test('history preview does not paint synthetic local waiting as an unread reply', async () => {
  const pending = {
    id: 44,
    content: '',
    activity: '합성 준비 중',
    initialResponse: {
      callId: 'pending',
      source: 'receipt' as const,
      text: '…',
    },
  };
  const session = {
    ...createEmptyConversation(12),
    messages: [{ ...user, delivery: sent }],
    pendingMessage: pending,
    requestActivity: activity('waiting'),
  };
  const view = await render(<ConversationHistoryPreview session={session} />);
  expect(screen.queryByTestId('conversation-assistant-message')).toBeNull();

  await view.rerender(
    <ConversationHistoryPreview
      session={{
        ...session,
        pendingMessage: { ...pending, content: '실제 부분 답변' },
        requestActivity: { ...activity('waiting'), requestId: 99 },
      }}
    />,
  );
  expect(screen.getByTestId('rag-conversation-stream')).toHaveTextContent(
    '실제 부분 답변',
  );
  expect(screen.queryByText('합성 준비 중')).toBeNull();
});

test('hands off to partial streaming, stays visible during tool work, and clears at settlement', async () => {
  const partial = {
    id: 44,
    role: 'assistant' as const,
    content: '부분 응답',
    citations: [],
  };
  const view = await render(
    history({
      requestSessionId: 12,
      requestActivity: activity('streaming'),
      pendingMessage: { id: 44, content: '부분 응답', activity: '작성 중' },
    }),
  );
  expect(
    screen.queryAllByTestId('rag-conversation-activity-bubble', {
      includeHiddenElements: true,
    }),
  ).toHaveLength(0);
  expect(screen.getByTestId('rag-conversation-stream')).toHaveTextContent(
    '부분 응답',
  );

  await view.rerender(
    history({
      requestSessionId: 12,
      requestActivity: activity('records'),
      pendingMessage: { id: 44, content: '부분 응답', activity: '작성 중' },
    }),
  );
  expect(
    screen.getByTestId('rag-conversation-activity-bubble', {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
  expect(screen.getByTestId('rag-conversation-stream')).toHaveTextContent(
    '부분 응답',
  );

  await view.rerender(
    history({
      error: '요청이 취소됐어요.',
      requestSessionId: 12,
      requestActivity: null,
      pendingMessage: null,
      messages: [
        {
          ...partial,
          incomplete: true,
          activity: '응답이 중단됐어요.',
        },
      ],
    }),
  );
  expect(
    screen.queryAllByTestId('rag-conversation-activity-bubble', {
      includeHiddenElements: true,
    }),
  ).toHaveLength(0);
  expect(
    screen.getByTestId('rag-conversation-incomplete-body'),
  ).toHaveTextContent('부분 응답');
  expect(screen.getByTestId('rag-conversation-error')).toHaveTextContent(
    /취소됐어요/,
  );
});

test('hides inline tool cards while preserving the active request indicator', async () => {
  const [toolEvent] = conversationToolEventFixtures;
  if (!toolEvent) throw new Error('Expected a synthetic tool event.');

  await render(
    history({
      requestSessionId: 12,
      requestActivity: activity('records'),
      pendingMessage: {
        id: 44,
        content: '',
        activity: '기록 찾는 중',
        toolMessageId: 'tool-message',
        toolEvents: [toolEvent],
      },
    }),
  );

  expect(
    screen.queryByTestId(
      `rag-tool-event-${toolEvent.operationRunId}-${toolEvent.callId}-toggle`,
    ),
  ).toBeNull();
  expect(
    screen.getByTestId('rag-conversation-activity-bubble', {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
});

test.each(['waiting', 'records', 'literature', 'cancelling'] as const)(
  'shows the activity bubble during the %s stage',
  async stage => {
    await render(
      history({
        requestSessionId: 12,
        requestActivity: activity(stage),
        pendingMessage: { id: 44, content: '', activity: '작업 중' },
      }),
    );
    expect(
      screen.getByTestId('rag-conversation-activity-bubble', {
        includeHiddenElements: true,
      }),
    ).toBeTruthy();
    expect(screen.queryByTestId('rag-conversation-stream')).toBeNull();
  },
);

test('ignores a late activity snapshot from another conversation session', async () => {
  await render(
    history({
      requestSessionId: 99,
      requestActivity: activity('waiting', 12),
    }),
  );

  expect(
    screen.queryAllByTestId('rag-conversation-activity-bubble', {
      includeHiddenElements: true,
    }),
  ).toHaveLength(0);
});

test('ignores a late snapshot from a completed request without pending work', async () => {
  await render(
    history({
      requestSessionId: 12,
      requestActivity: activity('waiting'),
      pendingMessage: null,
    }),
  );

  expect(
    screen.queryAllByTestId('rag-conversation-activity-bubble', {
      includeHiddenElements: true,
    }),
  ).toHaveLength(0);
});

test('ignores a stale same-session request while preserving the current partial answer', async () => {
  await render(
    history({
      requestSessionId: 12,
      requestActivity: { ...activity('waiting'), requestId: 33 },
      pendingMessage: { id: 45, content: '현재 응답', activity: '작성 중' },
    }),
  );

  expect(
    screen.queryAllByTestId('rag-conversation-activity-bubble', {
      includeHiddenElements: true,
    }),
  ).toHaveLength(0);
  expect(screen.getByTestId('rag-conversation-stream')).toHaveTextContent(
    '현재 응답',
  );
});
