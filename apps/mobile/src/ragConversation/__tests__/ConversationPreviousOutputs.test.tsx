import { render, screen } from '@testing-library/react-native';
import { ConversationMessage } from '../ConversationMessage';

test('labels prior raw output separately from the validated answer without source controls', async () => {
  await render(
    <ConversationMessage
      message={{
        id: 2,
        role: 'assistant',
        content: 'Validated answer',
        previousOutputs: ['Earlier raw text'],
      }}
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
    />,
  );
  expect(
    screen.getByText('추가 지시 전 중간 출력 · 최종 답변이 아니에요.'),
  ).toBeTruthy();
  expect(screen.getByText('Earlier raw text')).toBeTruthy();
  expect(screen.getByTestId('rag-conversation-answer-body')).toHaveTextContent(
    'Validated answer',
  );
});
