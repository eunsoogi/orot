import { render, screen } from '@testing-library/react-native';
import { ConversationMessage } from '../ConversationMessage';

jest.mock('../../layout/AiResponseText', () => ({
  AiResponseText: require('react-native').Text,
}));

test('preserves a saved partial answer without adding the redundant saved-partial notice', async () => {
  await render(
    <ConversationMessage
      message={{
        id: 1,
        role: 'assistant',
        content: '부분 답변',
        completion: 'partial',
      }}
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
    />,
  );
  expect(screen.queryByText('일부만 생성되어 저장된 답변이에요.')).toBeNull();
  expect(screen.getByText('부분 답변')).toBeTruthy();
});
