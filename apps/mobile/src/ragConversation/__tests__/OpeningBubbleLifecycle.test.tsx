import { render, screen, within } from '@testing-library/react-native';
import { ConversationMessage } from '../ConversationMessage';
import type { DisplayMessage } from '../conversationDisplayMessage';

const props = { onOpenSource: jest.fn(), onLinkError: jest.fn() };
const opening = {
  callId: 'synthetic-opening',
  text: '먼저 기록을 살펴볼게요.',
};

/** Synthetic presentation only; storage and owner fences remain covered by their own tests. */
test.each([
  { incomplete: true, content: '중단된 답변', activity: '중단됨' },
  { failed: true, content: '', activity: '다시 시도해 주세요.' },
  { retainedTurnId: 'saved-turn', content: '복원된 최종 답변' },
])(
  'keeps separate opening and answer surfaces through $content',
  async state => {
    const message: DisplayMessage = {
      id: 4,
      role: 'assistant',
      initialResponse: opening,
      ...state,
    };
    const view = await render(
      <ConversationMessage {...props} message={message} />,
    );
    const first = screen.getByTestId('conversation-assistant-opening-message');
    const answer = screen.getByTestId('conversation-assistant-message');
    expect(within(first).getByText(opening.text)).toBeTruthy();
    expect(within(answer).queryByText(opening.text)).toBeNull();
    expect(first.parent).toBe(answer.parent);
    const siblings = first.parent!.children;
    expect(siblings.indexOf(first)).toBeLessThan(siblings.indexOf(answer));
    await view.rerender(
      <ConversationMessage
        {...props}
        message={{ ...message, initialResponse: undefined }}
      />,
    );
    expect(
      screen.queryByTestId('conversation-assistant-opening-message'),
    ).toBeNull();
    expect(screen.queryByText(opening.text)).toBeNull();
  },
);

test('does not fabricate opening bubbles for legacy turns or user messages', async () => {
  const view = await render(
    <ConversationMessage
      {...props}
      message={{ id: 4, role: 'assistant', content: '기존 답변' }}
    />,
  );
  expect(
    screen.queryByTestId('conversation-assistant-opening-message'),
  ).toBeNull();
  await view.rerender(
    <ConversationMessage
      {...props}
      message={{
        id: 4,
        role: 'user',
        content: '질문',
        initialResponse: opening,
      }}
    />,
  );
  expect(
    screen.queryByTestId('conversation-assistant-opening-message'),
  ).toBeNull();
  expect(screen.getByTestId('conversation-user-message')).toHaveTextContent(
    '질문',
  );
});
