import { act, render } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { ConversationHistory } from '../ConversationHistory';
import { createConversationSessions } from '../conversationSessions';

test('keeps the same answer mounted when the streamed draft becomes the validated result', async () => {
  let complete: ((result: { finished: boolean }) => void) | undefined;
  const timing = jest.spyOn(Animated, 'timing').mockImplementation(() => ({
    start: callback => {
      complete = callback;
    },
    stop: jest.fn(),
    reset: jest.fn(),
  }));
  const props = { error: '', onOpenSource: jest.fn(), onLinkError: jest.fn() };
  const view = await render(
    <ConversationHistory
      {...props}
      messages={[]}
      pendingMessage={{
        id: 42,
        content: '이미 표시된 답변',
        activity: '작성 중',
      }}
    />,
  );
  await act(() => complete?.({ finished: true }));
  await view.rerender(
    <ConversationHistory
      {...props}
      messages={[
        {
          id: 42,
          role: 'assistant',
          content: '이미 표시된 답변',
          citations: [],
        },
      ]}
      pendingMessage={null}
    />,
  );
  expect(timing).toHaveBeenCalledTimes(1);
  timing.mockRestore();
});

test.each(['answer', 'cancel'] as const)(
  'reserves and retains the response identity through %s',
  async end => {
    const store = createConversationSessions();
    const id = store.getSnapshot().activeId;
    store.setDraft(id, '합성 질문');
    let finish!: (value: {
      status: 'answer';
      answer: string;
      citations: [];
    }) => void;
    const run = store.send(id, (_question, _history, _signal, observer) => {
      observer?.onTaskStreamEvent?.({ type: 'text_delta', text: '합성 답변' });
      return new Promise(resolve => {
        finish = resolve;
      });
    });
    const pending = store.getSnapshot().sessions[0]!.pendingMessage;
    expect(pending?.id).toEqual(expect.any(Number));
    if (end === 'cancel') store.cancel(id);
    finish({ status: 'answer', answer: '합성 답변', citations: [] });
    await run;
    expect(store.getSnapshot().sessions[0]!.messages.at(-1)?.id).toBe(
      pending?.id,
    );
    store.dispose();
  },
);
