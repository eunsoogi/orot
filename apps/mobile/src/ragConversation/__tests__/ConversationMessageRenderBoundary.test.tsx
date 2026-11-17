import { render, screen } from '@testing-library/react-native';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import { ConversationMessage } from '../ConversationMessage';

const mockBodyRender = jest.fn();
jest.mock('../../layout/AiResponseText', () => {
  const React = require('react');
  const Actual = jest.requireActual(
    '../../layout/AiResponseText',
  ).AiResponseText;
  return {
    AiResponseText: (props: { children: string }) => {
      mockBodyRender(props.children);
      return React.createElement(Actual, props);
    },
  };
});

beforeEach(() => mockBodyRender.mockClear());

// Count actual body entries, not wall-clock/FPS: native text measurement is outside this test.
test('stream updates do not re-enter unchanged saved bodies even with new callback identities', async () => {
  const saved = Array.from({ length: 40 }, (_, id) => ({
    id,
    role: 'assistant' as const,
    content: `Saved synthetic ${id}: ` + 'unchanged passage '.repeat(100),
  }));
  const renderTranscript = (content: string) => (
    <NavigationMotionContext.Provider value={true}>
      <ConversationTranscriptMessages
        messages={[
          ...saved,
          { id: 50, role: 'assistant', content, streaming: true },
        ]}
        pendingId={50}
        instructions={undefined}
        replyFocus={undefined}
        onLayout={() => {}}
        messageProps={{ onOpenSource: () => {}, onLinkError: () => {} }}
      />
    </NavigationMotionContext.Provider>
  );
  const view = await render(renderTranscript('chunk'));
  mockBodyRender.mockClear();
  for (let i = 1; i <= 12; i++) {
    await view.rerender(renderTranscript('chunk'.repeat(i + 1)));
  }
  expect(
    mockBodyRender.mock.calls.filter(([text]) => text.startsWith('Saved')),
  ).toHaveLength(0);
  expect(mockBodyRender.mock.calls).toHaveLength(12);
  expect(screen.getByTestId('rag-conversation-stream')).toHaveTextContent(
    'chunk'.repeat(13),
  );
});

test('replacement, stopped status and removal still update visible text and native identity', async () => {
  const body = (content: string, streaming: boolean) => (
    <NavigationMotionContext.Provider value={true}>
      <ConversationMessage
        message={{ id: 1, role: 'assistant', content, streaming }}
        onOpenSource={() => {}}
        onLinkError={() => {}}
      />
    </NavigationMotionContext.Provider>
  );
  const view = await render(body('Draft', true));
  await view.rerender(body('Replacement', true));
  expect(screen.queryByText('Draft')).toBeNull();
  expect(screen.getByTestId('rag-conversation-stream')).toHaveTextContent(
    'Replacement',
  );
  await view.rerender(body('Replacement', false));
  expect(screen.queryByTestId('rag-conversation-stream')).toBeNull();
  expect(screen.getByTestId('rag-conversation-answer-body')).toHaveTextContent(
    'Replacement',
  );
  expect(
    screen.getByTestId('rag-conversation-answer-body').props.selectable,
  ).toBe(true);
  await view.rerender(body('', false));
  expect(screen.queryByText('Replacement')).toBeNull();
});

test('memoized prose still receives motion-context changes and preserves full-size selectable text', async () => {
  const body = (reduced: boolean) => (
    <NavigationMotionContext.Provider value={reduced}>
      <ConversationMessage
        message={{ id: 1, role: 'assistant', content: 'Synthetic motion' }}
        onOpenSource={() => {}}
        onLinkError={() => {}}
      />
    </NavigationMotionContext.Provider>
  );
  const view = await render(body(false));
  expect(screen.getByTestId('ai-response-fragment')).toBeTruthy();
  await view.rerender(body(true));
  expect(screen.queryByTestId('ai-response-fragment')).toBeNull();
  expect(screen.getByTestId('rag-conversation-answer-body')).toHaveStyle({
    fontSize: 16,
    lineHeight: 24,
  });
  expect(
    screen.getByTestId('rag-conversation-answer-body').props.selectable,
  ).toBe(true);
});
