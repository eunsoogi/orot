import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationMessage } from '../ConversationMessage';
import { conversationToolEventFixtures } from '../testSupport/conversationToolEventFixtures';

const event = conversationToolEventFixtures[0]!;

test.each([
  { status: 'started', label: '진행 중', busy: true },
  { status: 'completed', label: '완료', busy: false },
  { status: 'failed', label: '실패', busy: false },
  { status: 'cancelled', label: '취소됨', busy: false },
  { status: 'interrupted', label: '중단됨', busy: false },
] as const)(
  'exposes $status state to assistive technology',
  async ({ status, label, busy }) => {
    await render(
      <ConversationMessage
        message={{
          id: 1,
          role: 'assistant',
          content: '',
          toolEvents: [{ ...event, status, sources: [] }],
        }}
        onOpenSource={jest.fn()}
        onLinkError={jest.fn()}
      />,
    );

    const toggle = screen.getByTestId(
      `rag-tool-event-${event.operationRunId}-${event.callId}-toggle`,
    );
    expect(toggle.props.accessibilityState).toEqual({ expanded: false, busy });
    expect(screen.getByText(label)).toBeTruthy();
    if (status === 'failed')
      expect(screen.getByRole('alert')).toHaveTextContent('실패');
    if (status === 'started')
      expect(screen.getByText(label).props.accessibilityLiveRegion).toBe(
        'polite',
      );
  },
);

test('keeps a missing result summary unavailable instead of showing zero', async () => {
  const failed = conversationToolEventFixtures[1]!;
  await render(
    <ConversationMessage
      message={{
        id: 1,
        role: 'assistant',
        content: '완성 답변',
        toolEvents: [failed],
      }}
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
    />,
  );

  await fireEvent.press(
    screen.getByTestId(
      `rag-tool-event-${failed.operationRunId}-${failed.callId}-toggle`,
    ),
  );
  expect(screen.getByText('결과 요약을 사용할 수 없어요.')).toBeTruthy();
  expect(screen.queryByText('참고 자료 0개')).toBeNull();
  expect(screen.getByTestId('rag-conversation-answer-body')).toHaveTextContent(
    '완성 답변',
  );
});

test('renders a retry as a separate call when the run changes but the call ID repeats', async () => {
  const firstAttempt = {
    ...event,
    operationRunId: 'first-attempt',
    status: 'failed' as const,
    sources: [],
  };
  const retryAttempt = {
    ...event,
    operationRunId: 'retry-attempt',
    status: 'started' as const,
    sources: [],
  };
  await render(
    <ConversationMessage
      message={{
        id: 1,
        role: 'assistant',
        content: '',
        toolEvents: [firstAttempt, retryAttempt],
      }}
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
    />,
  );

  const first = screen.getByTestId(
    `rag-tool-event-first-attempt-${event.callId}-toggle`,
  );
  const retry = screen.getByTestId(
    `rag-tool-event-retry-attempt-${event.callId}-toggle`,
  );
  expect(first.props.accessibilityState).toEqual({
    expanded: false,
    busy: false,
  });
  expect(retry.props.accessibilityState).toEqual({
    expanded: false,
    busy: true,
  });
  expect(screen.getByText('실패')).toBeTruthy();
  expect(screen.getByText('진행 중')).toBeTruthy();
});
