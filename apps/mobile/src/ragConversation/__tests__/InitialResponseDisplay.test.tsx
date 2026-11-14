import { render, screen } from '@testing-library/react-native';
import { ConversationMessage } from '../ConversationMessage';
import { ConversationInitialResponse } from '../ConversationInitialResponse';
import { initialConversationResponse } from '../initialResponse';

/** The initial reply is visible prose, not a progress spinner or validated final-answer body. */
test('shows the initial response while waiting, then the actual final answer', async () => {
  const props = { onOpenSource: jest.fn(), onLinkError: jest.fn() };
  const initial = {
    id: 2,
    role: 'assistant' as const,
    content: '',
    streaming: true,
    initialResponse: { callId: 'first', text: initialConversationResponse },
  };
  const view = await render(
    <ConversationMessage {...props} message={initial} />,
  );
  expect(
    screen.getByTestId('rag-conversation-initial-response'),
  ).toHaveTextContent(initialConversationResponse);
  expect(screen.queryByTestId('rag-conversation-answer-body')).toBeNull();
  await view.rerender(
    <ConversationMessage
      {...props}
      message={{ id: 2, role: 'assistant', content: '검증된 최종 답변' }}
    />,
  );
  expect(screen.queryByTestId('rag-conversation-initial-response')).toBeNull();
  expect(screen.getByTestId('rag-conversation-answer-body')).toHaveTextContent(
    '검증된 최종 답변',
  );
});

test('does not flash a receipt for fast answers and clears its timer when cancelled', async () => {
  jest.useFakeTimers();
  const { act } = require('@testing-library/react-native');
  const receipt = { source: 'receipt' as const, text: '질문을 받았어요.' };
  const scheduled = jest.spyOn(globalThis, 'setTimeout');
  const cleared = jest.spyOn(globalThis, 'clearTimeout');
  try {
    const view = await render(
      <ConversationInitialResponse key="first" response={receipt} />,
    );
    expect(
      screen.queryByTestId('rag-conversation-initial-response'),
    ).toBeNull();
    await act(async () => jest.advanceTimersByTime(749));
    expect(
      screen.queryByTestId('rag-conversation-initial-response'),
    ).toBeNull();
    await act(async () => jest.advanceTimersByTime(1));
    expect(
      screen.getByTestId('rag-conversation-initial-response'),
    ).toHaveTextContent('질문을 받았어요.');
    await view.rerender(
      <ConversationInitialResponse key="second" response={receipt} />,
    );
    expect(
      screen.queryByTestId('rag-conversation-initial-response'),
    ).toBeNull();
    const receiptTimer =
      scheduled.mock.results[
        scheduled.mock.calls.reduce(
          (last, call, index) => (call[1] === 750 ? index : last),
          -1,
        )
      ]?.value;
    expect(receiptTimer).toBeDefined();
    await view.unmount();
    expect(cleared).toHaveBeenCalledWith(receiptTimer);
  } finally {
    scheduled.mockRestore();
    cleared.mockRestore();
    jest.useRealTimers();
  }
});
