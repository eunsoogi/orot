import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationEntryAction } from '../ConversationEntryAction';
import { ConversationTaskHeader } from '../ConversationTaskPanels';
import { createConversationSessions } from '../conversationSessions';
import { setConversationEntryForSession } from '../useConversationEntryIntent';

const actions = {
  possibilities: jest.fn(),
  visitQuestions: jest.fn(),
  healthSummary: jest.fn(),
};

test('entry-specific visit preparation replaces the duplicate generic action without dropping context', async () => {
  const store = createConversationSessions();
  setConversationEntryForSession(store, 1, {
    intent: 'visit-questions',
    entryKey: 'synthetic-entry',
    appointmentId: 'synthetic-visit',
  });
  store.prepareEntry(1, 'Synthetic visit question');
  const session = store.getSnapshot().sessions[0]!;
  await render(
    <>
      <ConversationEntryAction
        store={store}
        session={session}
        prepareVisitQuestions={jest.fn()}
      />
      <ConversationTaskHeader
        store={store}
        session={session}
        onOpenSource={jest.fn()}
        reportOwner={null}
        retainedActions={actions}
      />
    </>,
  );
  expect(screen.getAllByText('진료 질문 준비하기')).toHaveLength(1);
  expect(screen.getByTestId('conversation-visit-prepare')).toBeTruthy();
  expect(screen.queryByTestId('conversation-open-visit-questions')).toBeNull();
  expect(store.getSnapshot().sessions).toHaveLength(1);
});

test('busy report action is disabled and a stale enabled callback cannot start a new task', async () => {
  const store = createConversationSessions();
  const request = jest.fn();
  const header = () => (
    <ConversationTaskHeader
      store={store}
      session={store.getSnapshot().sessions[0]!}
      onOpenSource={jest.fn()}
      reportOwner={null}
      onOpenDailyReport={request}
      retainedActions={actions}
    />
  );
  const view = await render(header());
  const staleButton = screen.getByTestId('daily-report-request');
  store.setDraft(1, 'Preserve this draft');
  await fireEvent.press(staleButton);
  expect(request).not.toHaveBeenCalled();
  expect(store.getSnapshot().sessions[0]!.draft).toBe('Preserve this draft');
  store.setDraft(1, 'Synthetic pending question');
  let finish!: (value: {
    status: 'answer';
    answer: string;
    citations: never[];
  }) => void;
  const pending = store.send(
    1,
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await view.rerender(header());
  expect(screen.getByTestId('daily-report-request')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('daily-report-request'));

  await fireEvent.press(staleButton);
  expect(request).not.toHaveBeenCalled();
  finish({ status: 'answer', answer: 'Synthetic response', citations: [] });
  await pending;
});
