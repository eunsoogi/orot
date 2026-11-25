import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Linking } from 'react-native';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import {
  ConversationMessage,
  type DisplayMessage,
} from '../ConversationMessage';
import { conversationBubbleCopyText } from '../conversationBubbleCopyText';

const markdown = [
  '## Synthetic heading',
  'First **strong** and *italic* paragraph.',
  '',
  '- First item',
  '2. Second item with `code`.',
  '',
  '[Public page](https://example.org/info)',
  '',
  '```js',
  'const a = 3;',
  '```',
].join('\n');

function bubble(message: DisplayMessage, onLinkError = jest.fn()) {
  return (
    <NavigationMotionContext.Provider value>
      <ConversationMessage
        message={message}
        onOpenSource={jest.fn()}
        onLinkError={onLinkError}
      />
    </NavigationMotionContext.Provider>
  );
}

afterEach(() => jest.restoreAllMocks());

test.each([false, true])(
  'formats the same protected assistant answer when restored=%s',
  async restored => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    open.mockClear();
    const message = {
      id: 2,
      role: 'assistant' as const,
      content: markdown,
      ...(restored
        ? {
            savedHistoryDisplayOnly: true as const,
            restoredHistory: true as const,
          }
        : {}),
    };
    await render(bubble(message));
    expect(screen.getByRole('header')).toHaveTextContent('Synthetic heading');
    expect(screen.getByText('strong')).toHaveStyle({ fontWeight: '700' });
    expect(screen.getByText('italic')).toHaveStyle({ fontStyle: 'italic' });
    expect(screen.getByText('• First item')).toBeVisible();
    expect(screen.getByText(/2\. Second item with/u)).toBeVisible();
    expect(screen.getByText('const a = 3;')).toHaveStyle({
      fontFamily: 'Menlo',
    });
    expect(conversationBubbleCopyText(message)).toBe(markdown);
    const link = screen.getByText('Public page');
    expect(link.props.accessibilityRole).toBe('link');
    expect(open).not.toHaveBeenCalled();
    await fireEvent.press(link);
    expect(open).toHaveBeenCalledWith('https://example.org/info');
  },
);

test('keeps one outer bubble while an unfinished stream becomes formatted', async () => {
  const pending: DisplayMessage = {
    id: 3,
    role: 'assistant',
    content: '**uns',
    streaming: true,
  };
  const view = await render(bubble(pending));
  const host = screen.getByTestId('conversation-assistant-message');
  expect(screen.getByTestId('rag-conversation-stream')).toHaveTextContent(
    '**uns',
  );
  await view.rerender(bubble({ ...pending, content: '**unsettled**' }));
  expect(screen.getByTestId('conversation-assistant-message')).toBe(host);
  expect(screen.getByTestId('rag-conversation-stream')).toHaveTextContent(
    '**unsettled**',
  );
  await view.rerender(
    bubble({ ...pending, content: '**unsettled**', streaming: false }),
  );
  expect(screen.getByTestId('conversation-assistant-message')).toBe(host);
  expect(screen.getByText('unsettled')).toHaveStyle({ fontWeight: '700' });
});

test('uses only the newest link error handler after a memoized repaint', async () => {
  jest
    .spyOn(Linking, 'openURL')
    .mockRejectedValue(new Error('Synthetic denial'));
  const message = { id: 2, role: 'assistant' as const, content: markdown };
  const old = jest.fn();
  const next = jest.fn();
  const view = await render(bubble(message, old));
  await view.rerender(bubble(message, next));
  await fireEvent.press(screen.getByText('Public page'));
  await waitFor(() => expect(next).toHaveBeenCalledTimes(1));
  expect(old).not.toHaveBeenCalled();
});

test('keeps user, unsafe links, raw HTML and remote images noninteractive', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  open.mockClear();
  await render(
    <>
      {bubble({ id: 1, role: 'user', content: '**user syntax**' })}
      {bubble({
        id: 2,
        role: 'assistant',
        content:
          '## Synthetic\n[Bad link](file:///private)\n<img src="https://example.org">\n![Image](https://example.org/x.png)',
      })}
    </>,
  );
  expect(screen.getByText('**user syntax**')).toBeVisible();
  expect(screen.getByText(/file:\/\/\/private/u)).toBeVisible();
  expect(screen.getByText(/<img src=/u)).toBeVisible();
  expect(screen.queryByRole('link')).toBeNull();
  expect(open).not.toHaveBeenCalled();
});

test('plain paragraphs preserve the original newline separators', async () => {
  const content = '합성 최종 답변\n\n공개 웹검색을 사용할 수 없어요.';
  await render(bubble({ id: 2, role: 'assistant', content }));
  expect(screen.getByText(content)).toBeVisible();
});
