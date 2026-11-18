import { render, screen } from '@testing-library/react-native';
import { ConversationScreen } from '../ConversationScreen';

/** Cross-model archive removal does not remove the current transcript or composer. */
test('offers no separate previous-conversation button or modal', async () => {
  await render(
    <ConversationScreen
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
      onSend={jest.fn()}
    />,
  );
  expect(screen.queryByText('이전 대화 보기')).toBeNull();
  expect(
    screen.queryByTestId('conversation-readonly-archive', {
      includeHiddenElements: true,
    }),
  ).toBeNull();
  expect(screen.getByTestId('rag-conversation-history')).toBeTruthy();
  expect(screen.getByTestId('rag-conversation-composer')).toBeTruthy();
});
