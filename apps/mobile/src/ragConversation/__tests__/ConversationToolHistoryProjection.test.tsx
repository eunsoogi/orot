import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { useState, useSyncExternalStore } from 'react';
import { Pressable, Text } from 'react-native';
import type { ConversationToolEvent } from '@orot/agent-runtime';
import { ConversationHistory } from '../ConversationHistory';
import {
  createConversationSessions,
  type ConversationSessions,
} from '../conversationSessions';
import type { ConversationSender } from '../conversationSessionTypes';
import * as display from '../conversationSavedHistoryDisplay';

function MountedTranscript({ store }: { store: ConversationSessions }) {
  const { activeId, sessions } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
  );
  const session = sessions.find(row => row.id === activeId)!;
  const [passiveCount, setCount] = useState(0);
  return (
    <>
      <Pressable
        testID="synthetic-sibling-control"
        onPress={() => setCount(count => count + 1)}
      >
        <Text>{'Passive surface ' + passiveCount}</Text>
      </Pressable>
      <ConversationHistory
        sessionId={activeId}
        messages={session.messages}
        pendingMessage={session.pendingMessage}
        error={session.error}
        onOpenSource={jest.fn()}
        onLinkError={jest.fn()}
      />
    </>
  );
}

test('a held stock turn shows new streamed output without rebuilding the settled transcript', async () => {
  const store = createConversationSessions();
  const { activeId } = store.getSnapshot();
  const prior: Awaited<ReturnType<ConversationSender>> = {
    status: 'answer',
    answer: 'Synthetic settled answer',
    citations: [],
  };
  await store.sendPrompt(
    activeId,
    'Synthetic earlier question',
    async () => prior,
  );
  const projection = jest.spyOn(display, 'savedHistoryTranscript');
  const view = await render(<MountedTranscript store={store} />);
  let observer: Parameters<ConversationSender>[3];
  let finish!: (answer: Awaited<ReturnType<ConversationSender>>) => void;
  const sender: ConversationSender = async (
    _question,
    _history,
    _signal,
    callbacks,
  ) => {
    observer = callbacks;
    return new Promise(resolve => {
      finish = resolve;
    });
  };
  let work: Promise<void> | undefined;
  try {
    await act(async () => {
      work = store.sendPrompt(activeId, 'Synthetic current question', sender);
    });
    await waitFor(() => expect(finish).toBeDefined());
    const before = projection.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    const event: ConversationToolEvent = {
      version: 1,
      operationRunId: 'fixture-run',
      callId: 'fixture-call',
      toolName: 'record-search',
      order: 0,
      status: 'started',
      inputSummary: { sourceKind: 'personal_record' },
      sources: [],
    };
    await act(async () => {
      observer?.onToolEvent?.(event);
      observer?.onToolEvent?.({ ...event, status: 'completed' });
      observer?.onTaskStreamEvent?.({
        type: 'text_snapshot',
        text: 'Synthetic live output',
      });
    });
    await fireEvent.press(screen.getByTestId('synthetic-sibling-control'));
    expect(screen.getByText('Passive surface 1')).toBeTruthy();
    expect(await screen.findByText('Synthetic live output')).toBeTruthy();
    expect(screen.getByText('Synthetic settled answer')).toBeTruthy();
    expect(projection).toHaveBeenCalledTimes(before);
  } finally {
    await act(async () => {
      finish?.({ status: 'no_evidence' });
      await work;
    });
    await view.unmount();
    store.dispose();
    projection.mockRestore();
  }
});
