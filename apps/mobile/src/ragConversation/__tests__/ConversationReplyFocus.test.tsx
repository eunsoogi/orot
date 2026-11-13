import { fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import { ConversationHistory } from '../ConversationHistory';

jest.mock('../../layout/AiResponseText', () => ({
  AiResponseText: require('react-native').Text,
}));

test('reveals the requested saved reply instead of following a later message', async () => {
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
  const done = jest.fn();
  await render(
    <ConversationHistory
      messages={[
        {
          id: 1,
          role: 'assistant',
          content: '첫 답변',
          retainedTurnId: 'first',
        },
        {
          id: 2,
          role: 'assistant',
          content: '나중 답변',
          retainedTurnId: 'second',
        },
      ]}
      pendingMessage={null}
      error=""
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
      replyFocus={{
        generation: 1,
        messageId: 'first',
        canReveal: () => true,
        complete: () => {
          done();
          return true;
        },
      }}
    />,
  );
  await fireEvent(
    screen.getByTestId('conversation-message-container'),
    'layout',
    { nativeEvent: { layout: { y: 120 } } },
  );
  await fireEvent(screen.getByTestId('conversation-reply-focus'), 'layout', {
    nativeEvent: { layout: { y: 340 } },
  });
  expect(scrollTo).toHaveBeenCalledWith({ y: 460, animated: false });
  expect(done).toHaveBeenCalledTimes(1);
  scrollTo.mockRestore();
});

test('uses the existing container position when a warm reply tap arrives later', async () => {
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
  const done = jest.fn();
  const props = {
    messages: [
      {
        id: 1,
        role: 'assistant' as const,
        content: '답변',
        retainedTurnId: 'answer',
      },
    ],
    pendingMessage: null,
    error: '',
    onOpenSource: jest.fn(),
    onLinkError: jest.fn(),
  };
  const view = await render(<ConversationHistory {...props} />);
  await fireEvent(
    screen.getByTestId('conversation-message-container'),
    'layout',
    { nativeEvent: { layout: { y: 100 } } },
  );
  await view.rerender(
    <ConversationHistory
      {...props}
      replyFocus={{
        generation: 2,
        messageId: 'answer',
        canReveal: () => true,
        complete: () => {
          done();
          return true;
        },
      }}
    />,
  );
  await fireEvent(screen.getByTestId('conversation-reply-focus'), 'layout', {
    nativeEvent: { layout: { y: 240 } },
  });
  expect(scrollTo).toHaveBeenCalledWith({ y: 340, animated: false });
  expect(done).toHaveBeenCalledTimes(1);
  scrollTo.mockRestore();
});
