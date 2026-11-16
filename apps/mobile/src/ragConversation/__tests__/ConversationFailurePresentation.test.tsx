import { render, screen } from '@testing-library/react-native';
import { ConversationHistory } from '../ConversationHistory';
import type { DisplayMessage } from '../ConversationMessage';

const failure = '답변을 확인하지 못했어요.';
const failedReply: DisplayMessage = {
  id: 2,
  role: 'assistant',
  content: '',
  incomplete: true,
  activity: failure,
};

/** Test the displayed transcript, not removal of the underlying failure/retry state. */
async function show(messages: readonly DisplayMessage[], error = failure) {
  await render(
    <ConversationHistory
      messages={messages}
      pendingMessage={null}
      error={error}
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
    />,
  );
}

test('shows retained failure guidance once instead of a second footer error', async () => {
  await show([{ id: 1, role: 'user', content: '질문' }, failedReply]);
  expect(screen.getAllByText(failure)).toHaveLength(1);
  expect(screen.queryByTestId('rag-conversation-error')).toBeNull();
});

test('keeps standalone failure guidance when no assistant reply was retained', async () => {
  await show([{ id: 1, role: 'user', content: '질문' }]);
  expect(screen.getByTestId('rag-conversation-error')).toHaveTextContent(
    failure,
  );
});

test('does not hide a separate save failure beside a retained reply', async () => {
  await show([failedReply], '저장하지 못했어요.');
  expect(screen.getByTestId('rag-conversation-error')).toHaveTextContent(
    '저장하지 못했어요.',
  );
  expect(screen.getByText(failure)).toBeTruthy();
});

test('an older matching failure cannot hide the latest request error', async () => {
  await show([failedReply, { id: 3, role: 'user', content: '새 질문' }]);
  expect(screen.getByTestId('rag-conversation-error')).toHaveTextContent(
    failure,
  );
});
