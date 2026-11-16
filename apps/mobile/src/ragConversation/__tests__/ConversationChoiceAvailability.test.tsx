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

test('entry-specific visit preparation stays in the canonical slot without dropping context', async () => {
  const store = createConversationSessions();
  setConversationEntryForSession(store, 1, {
    intent: 'visit-questions',
    entryKey: 'synthetic-entry',
    appointmentId: 'synthetic-visit',
  });
  store.prepareEntry(1, 'Synthetic visit question');
  const session = store.getSnapshot().sessions[0]!;
  await render(
    <ConversationTaskHeader
      store={store}
      session={session}
      onOpenSource={jest.fn()}
      reportOwner={null}
      retainedActions={actions}
      visitAction={
        <ConversationEntryAction
          store={store}
          session={session}
          prepareVisitQuestions={jest.fn()}
        />
      }
    />,
  );
  expect(screen.getAllByText('진료 질문 준비하기')).toHaveLength(1);
  expect(screen.getByTestId('conversation-visit-prepare')).toBeTruthy();
  expect(screen.queryByTestId('conversation-open-visit-questions')).toBeNull();
  expect(
    screen
      .getAllByRole('button')
      .map(button => button.props.accessibilityLabel),
  ).toEqual([
    '질병 가능성 보고서 요청하기',
    '진료 질문 준비하기',
    '내 건강 정보 요약하기',
  ]);
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
