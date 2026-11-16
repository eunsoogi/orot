import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { WorkflowOperationJournal } from '@orot/agent-runtime';
import { ConversationScreen } from '../ConversationScreen';
import type { ConversationSender } from '../conversationSessionTypes';
import type { RagConversationOutcome } from '../service';

test('real composer queues live text through the current request owner without stopping', async () => {
  type Steering = NonNullable<WorkflowOperationJournal['steering']>;
  let rows: Awaited<ReturnType<Steering['list']>> = [];
  let refresh: (() => Promise<void>) | undefined;
  const journal: Steering = {
    enqueue: jest.fn(async (id, text) => {
      rows = [{ id, text, sequence: 1, status: 'queued' }];
      await refresh?.();
      return true;
    }),
    list: async () => rows,
    bind: async () => undefined,
    acknowledge: async () => false,
    subscribe: listener => {
      refresh = listener;
      return () => {
        refresh = undefined;
      };
    },
  };
  let finish!: (result: RagConversationOutcome) => void;
  let signal: AbortSignal | undefined;
  const sender: ConversationSender = (
    _question,
    _history,
    current,
    observer,
  ) => {
    signal = current;
    rows = [];
    observer?.onSteeringReady?.(journal);
    return new Promise(resolve => {
      finish = resolve;
    });
  };
  await render(
    <ConversationScreen
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
      onSend={sender}
    />,
  );
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    'Synthetic question',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  expect(screen.getByTestId('rag-conversation-cancel')).toBeTruthy();
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    'Keep the synthetic answer brief',
  );
  expect(screen.queryByTestId('rag-conversation-cancel')).toBeNull();
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  expect(journal.enqueue).toHaveBeenCalledWith(
    expect.any(String),
    'Keep the synthetic answer brief',
  );
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe('');
  expect(signal?.aborted).toBe(false);
  expect(screen.getByTestId('rag-conversation-cancel')).toBeTruthy();
  expect(screen.queryByTestId('conversation-steering-controls')).toBeNull();
  expect(screen.getByTestId('conversation-steering-message')).toBeTruthy();
  expect(screen.queryByText('보냄')).toBeNull();
  expect(screen.queryByText('읽음')).toBeNull();
  await act(async () => {
    rows = rows.map(row => ({ ...row, status: 'applied' }));
    await refresh?.();
    finish({ status: 'answer', answer: 'Synthetic response', citations: [] });
  });
  expect(screen.queryByTestId('conversation-steering-send')).toBeNull();
  expect(screen.getByText('읽음')).toBeTruthy();
  expect(signal?.aborted).toBe(false);
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    'Next synthetic question',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  expect(screen.getAllByText('Keep the synthetic answer brief')).toHaveLength(
    1,
  );
  expect(screen.getAllByText('읽음')).toHaveLength(1);
  await act(async () => {
    finish({
      status: 'answer',
      answer: 'Next synthetic response',
      citations: [],
    });
  });
});

test('an unready steering owner cannot turn a typed Send into cancellation', async () => {
  let finish!: (result: RagConversationOutcome) => void;
  let signal: AbortSignal | undefined;
  const sender: ConversationSender = (_question, _history, current) => {
    signal = current;
    return new Promise(resolve => {
      finish = resolve;
    });
  };
  await render(
    <ConversationScreen
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
      onSend={sender}
    />,
  );
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    'Synthetic question',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    'Wait for the current owner',
  );
  expect(screen.queryByTestId('rag-conversation-cancel')).toBeNull();
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  expect(signal?.aborted).toBe(false);
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
    'Wait for the current owner',
  );
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '   ',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-cancel'));
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    finish({ status: 'unavailable' });
  });
});
