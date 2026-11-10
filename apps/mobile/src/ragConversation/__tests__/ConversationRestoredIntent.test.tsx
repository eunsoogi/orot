import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationScreen } from '../ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../ConversationSessionsContext';
import type { ConversationSessions } from '../conversationSessions';

test('continues a restored possibilities conversation after a plain route entry', async () => {
  let store!: ConversationSessions;
  let attached = false;
  const retention = {
    attachExisting: async () => {
      attached = true;
    },
    activeIdentity: () => (attached ? 'saved' : null),
    activeLease: () => null,
    beginTurn: async () => undefined,
    invalidate: () => {},
  };
  const options = {
    retention: retention as never,
    restoreSession: async () => [
      {
        question: '피로가 있어요',
        answer: '언제부터 시작됐나요?',
        citations: [],
        entryIntent: 'possibilities' as const,
      },
    ],
  };
  const send = jest.fn(async () => ({
    status: 'answer' as const,
    answer: '확인이 필요해요.',
    citations: [],
  }));
  function Capture() {
    store = useConversationSessions();
    return (
      <ConversationScreen
        entryContext={{ intent: 'conversation', entryKey: 'plain' }}
        onBack={jest.fn()}
        onOpenSource={jest.fn()}
        onSend={send}
      />
    );
  }
  await render(
    <ConversationSessionsProvider options={options}>
      <Capture />
    </ConversationSessionsProvider>,
  );
  await act(async () => {
    await store.attachExisting('saved', 0, '2026-10-05T00:00:00.000Z');
  });
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '지난주부터예요',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  expect(send).toHaveBeenCalledWith(
    '지난주부터예요',
    expect.any(Array),
    expect.any(AbortSignal),
    expect.any(Object),
    expect.objectContaining({ intent: 'possibilities' }),
  );
});
