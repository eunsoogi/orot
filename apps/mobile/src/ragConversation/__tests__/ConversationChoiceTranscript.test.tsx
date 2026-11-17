import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { createDailyReportIdentity } from '@orot/domain';
import { ConversationScreen } from '../ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../ConversationSessionsContext';
import { conversationChoiceActions } from '../selectConversationChoice';
import { startConversationReportTurn } from '../startConversationReportTurn';
import type { ConversationSessions } from '../conversationSessions';
import type { ConversationScreenProps } from '../ConversationScreenProps';

/** Synthetic sender proves UI dispatch and transcript ownership, not model quality or external consent. */
test('all four chat choices remain in one transcript and allow a report follow-up', async () => {
  let store!: ConversationSessions;
  const target = {
    identity: createDailyReportIdentity('2035-01-01', 'UTC')!,
    runId: 'synthetic',
    revision: 1,
  };
  const sender = jest.fn(
    async (...args: Parameters<ConversationScreenProps['onSend']>) => ({
      status: 'answer' as const,
      answer: `Synthetic ${args[4]?.intent ?? 'conversation'} result`,
      citations: [],
      ...(args[4]?.intent === 'daily-report' ? { dailyReport: target } : {}),
    }),
  );
  const back = jest.fn();
  function Capture() {
    store = useConversationSessions();
    const actions = conversationChoiceActions(store, () => true);
    return (
      <ConversationScreen
        onBack={back}
        onOpenSource={jest.fn()}
        onSend={sender}
        prepareVisitQuestions={sender}
        onOpenDailyReport={() => {
          startConversationReportTurn(store, () => true, sender);
        }}
        retainedActions={{
          possibilities: actions.onOpenDiseaseHypotheses,
          healthSummary: actions.onOpenHealthSummary,
          visitQuestions: actions.onOpenVisitQuestions,
        }}
      />
    );
  }
  await render(
    <ConversationSessionsProvider>
      <Capture />
    </ConversationSessionsProvider>,
  );
  await fireEvent.press(screen.getByTestId('daily-report-request'));
  await waitFor(() =>
    expect(screen.getByText('Synthetic daily-report result')).toBeTruthy(),
  );
  // A historical report remains visible, but only an explicit selection binds a follow-up.
  const session = store.getSnapshot().sessions[0];
  expect(session.dailyReport).toBeUndefined();
  expect(session.messages.some(message => message.dailyReport === target)).toBe(
    true,
  );
  // Consumed report metadata must not rerun or bind the next ordinary question.
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    'Synthetic independent question',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  await waitFor(() => expect(sender).toHaveBeenCalledTimes(2));
  expect(sender.mock.calls[1][4]?.intent).toBe('conversation');
  expect(sender.mock.calls[1][4]?.dailyReport).toBeUndefined();
  await waitFor(() => expect(store.getSnapshot().sessions[0].busy).toBe(false));
  await act(() => store.selectDailyReport(session.id, target));
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    'Synthetic report follow-up',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  await waitFor(() => expect(sender).toHaveBeenCalledTimes(3));
  expect(sender.mock.calls[2][4]).toMatchObject({ dailyReport: target });
  await waitFor(() => expect(store.getSnapshot().sessions[0].busy).toBe(false));
  for (const [index, button] of [
    'conversation-open-possibilities',
    'conversation-open-health-summary',
    'conversation-open-visit-questions',
  ].entries()) {
    await fireEvent.press(screen.getByTestId(button));
    await waitFor(() => expect(sender).toHaveBeenCalledTimes(index + 4));
    await waitFor(() =>
      expect(store.getSnapshot().sessions[0].busy).toBe(false),
    );
  }
  expect(store.getSnapshot().sessions).toHaveLength(1);
  expect(store.getSnapshot().sessions[0].messages).toHaveLength(12);
  expect(screen.getAllByTestId('conversation-assistant-message')).toHaveLength(
    6,
  );
  expect(screen.getByText('Synthetic daily-report result')).toBeTruthy();
  expect(screen.queryByTestId('inline-daily-report-task')).toBeNull();
  expect(screen.queryByTestId('daily-report-screen')).toBeNull();
  expect(back).not.toHaveBeenCalled();
});

test.each(['cancel', 'failure'] as const)(
  'report %s remains in the shared chat recovery surface',
  async outcome => {
    let store!: ConversationSessions;
    let signal: AbortSignal | undefined;
    let finish!: (
      value: Awaited<ReturnType<ConversationScreenProps['onSend']>>,
    ) => void;
    const sender: ConversationScreenProps['onSend'] = (
      _question,
      _history,
      currentSignal,
    ) => {
      signal = currentSignal;
      return new Promise(resolve => {
        finish = resolve;
      });
    };
    function Capture() {
      store = useConversationSessions();
      return (
        <ConversationScreen
          onBack={jest.fn()}
          onOpenSource={jest.fn()}
          onSend={sender}
          onOpenDailyReport={() => {
            startConversationReportTurn(store, () => true, sender);
          }}
        />
      );
    }
    await render(
      <ConversationSessionsProvider>
        <Capture />
      </ConversationSessionsProvider>,
    );
    await fireEvent.press(screen.getByTestId('daily-report-request'));
    await waitFor(() => expect(signal).toBeDefined());
    if (outcome === 'cancel') {
      await fireEvent.press(screen.getByTestId('rag-conversation-cancel'));
      expect(signal?.aborted).toBe(true);
      await act(() =>
        finish({
          status: 'answer',
          answer: 'Synthetic late report must not appear',
          citations: [],
        }),
      );
    } else {
      await act(() => finish({ status: 'failure', kind: 'consent_required' }));
    }
    await waitFor(() =>
      expect(store.getSnapshot().sessions[0].busy).toBe(false),
    );
    expect(store.getSnapshot().sessions).toHaveLength(1);
    expect(
      screen.queryByText('Synthetic late report must not appear'),
    ).toBeNull();
    expect(screen.queryByTestId('inline-daily-report-task')).toBeNull();
    expect(screen.getByTestId('rag-conversation-input').props.editable).toBe(
      true,
    );
    if (outcome === 'failure')
      expect(screen.getByTestId('rag-conversation-error')).toBeTruthy();
  },
);
