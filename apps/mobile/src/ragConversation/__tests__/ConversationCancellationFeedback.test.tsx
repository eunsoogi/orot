import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationComposer } from '../ConversationComposer';
import { createConversationSessions } from '../conversationSessions';

// Synthetic presentation evidence, not native tap delivery or provider latency proof.
test('acknowledges pending cancellation without allowing another send or Stop', async () => {
  const props = {
    value: 'Synthetic draft',
    busy: true,
    onChangeText: jest.fn(),
    onSend: jest.fn(),
    onCancel: jest.fn(),
    status: 'Existing attachment warning',
  };
  const view = await render(<ConversationComposer {...props} />);
  await fireEvent(
    screen.getByTestId('rag-conversation-cancel'),
    'composerPress',
  );
  expect(props.onCancel).toHaveBeenCalledTimes(1);
  await view.rerender(<ConversationComposer {...props} cancelling />);
  const action = screen.getByTestId('rag-conversation-cancel');
  expect(action.props).toMatchObject({
    busy: true,
    disabled: true,
    actionLabel: '요청을 중단하고 있어요',
  });
  expect(
    screen.getByText('요청을 중단하고 있어요').props.accessibilityLiveRegion,
  ).toBe('polite');
  expect(screen.getByText('Existing attachment warning')).toBeTruthy();
  expect(screen.getByTestId('rag-conversation-input').props.editable).toBe(
    true,
  );
  // Exercise the current bridge callback directly, independently of native disabled behavior.
  action.props.onComposerPress();
  expect(props.onCancel).toHaveBeenCalledTimes(1);
  expect(props.onSend).not.toHaveBeenCalled();
  await view.rerender(
    <ConversationComposer {...props} busy={false} cancelling />,
  );
  expect(screen.queryByText('요청을 중단하고 있어요')).toBeNull();
  await fireEvent(screen.getByTestId('rag-conversation-send'), 'composerPress');
  expect(props.onSend).toHaveBeenCalledTimes(1);
});

test('publishes cancelling immediately while preserving the summary commit fence', async () => {
  const sessions = createConversationSessions();
  let release!: () => void;
  let signal!: AbortSignal;
  sessions.setDraft(1, 'Synthetic summary');
  const pending = sessions.send(
    1,
    async (_question, _history, currentSignal, observer) => {
      signal = currentSignal!;
      observer?.onSummarySaveStart?.();
      await new Promise<void>(resolve => {
        release = resolve;
      });
      observer?.onSummarySaveSettled?.(true);
      return {
        status: 'answer',
        answer: 'Synthetic saved summary',
        citations: [],
      };
    },
  );
  sessions.cancel(1);
  expect(signal.aborted).toBe(true);
  expect(sessions.getSnapshot().sessions[0]).toMatchObject({
    busy: true,
    requestActivity: { stage: 'cancelling' },
  });
  release();
  await pending;
  expect(sessions.getSnapshot().sessions[0]).toMatchObject({
    busy: false,
    requestActivity: null,
  });
  expect(
    sessions
      .getSnapshot()
      .sessions[0]!.messages.some(
        message => message.content === 'Synthetic saved summary',
      ),
  ).toBe(true);
  sessions.dispose();
});
