import type { ComponentProps, ReactElement } from 'react';
import { render, screen } from '@testing-library/react-native';
import type { TextProps } from 'react-native';

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
import type { ConversationActivitySnapshot } from '../conversationActivity';
import { conversationToolEventFixtures } from '../testSupport/conversationToolEventFixtures';

const callbacks = {
  error: '',
  onOpenSource: jest.fn(),
  onLinkError: jest.fn(),
};

function activity(
  stage: ConversationActivitySnapshot['stage'],
  sessionId = 12,
): ConversationActivitySnapshot {
  return { sessionId, requestId: 44, stage };
}

function history(props: Partial<ComponentProps<typeof ConversationHistory>>) {
  return (
    <ConversationHistory
      {...callbacks}
      messages={[]}
      pendingMessage={null}
      {...props}
    />
  );
}

test('shows one activity bubble before the first token without an empty assistant message', async () => {
  await render(
    history({
      requestSessionId: 12,
      requestActivity: activity('preparing'),
      pendingMessage: { id: 44, content: '', activity: '답변 준비 중' },
    }),
  );

  expect(
    screen.getByTestId('rag-conversation-activity-bubble', {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
  expect(
    screen.getAllByTestId('rag-conversation-activity-dot', {
      includeHiddenElements: true,
    }),
  ).toHaveLength(3);
  expect(screen.queryByTestId('rag-conversation-stream')).toBeNull();
  expect(screen.queryByTestId('rag-conversation-progress')).toBeNull();
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

test('keeps existing tool cards beside the bubble while another request phase is active', async () => {
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
    screen.getByTestId(
      `rag-tool-event-${toolEvent.operationRunId}-${toolEvent.callId}-toggle`,
    ),
  ).toBeTruthy();
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
