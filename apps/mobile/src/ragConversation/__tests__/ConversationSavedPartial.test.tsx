import { render, screen } from '@testing-library/react-native';
import { ConversationMessage } from '../ConversationMessage';

jest.mock('../../layout/AiResponseText', () => ({
  AiResponseText: require('react-native').Text,
}));

test('marks a saved partial answer without calling it an unfinished stream', async () => {
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
  expect(screen.getByText('일부만 생성되어 저장된 답변이에요.')).toBeTruthy();
  expect(screen.getByText('부분 답변')).toBeTruthy();
});
