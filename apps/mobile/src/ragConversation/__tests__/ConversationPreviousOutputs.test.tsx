import { render, screen } from '@testing-library/react-native';
import { styles } from '../ConversationScreen.styles';
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
  expect(styles.messageText).toEqual({ fontSize: 16, lineHeight: 24 });
  const previous = screen.getByText('Earlier raw text');
  expect(previous).toHaveStyle(styles.messageText);
  expect(previous.props.allowFontScaling).toBe(true);
  expect(previous.props.adjustsFontSizeToFit).toBe(false);
  expect(previous.props.maxFontSizeMultiplier).toBeUndefined();
  expect(previous.props.numberOfLines).toBeUndefined();
  expect(screen.getByTestId('rag-conversation-answer-body')).toHaveStyle(
    styles.messageText,
  );
  expect(screen.getByTestId('rag-conversation-answer-body')).toHaveTextContent(
    'Validated answer',
  );
});
