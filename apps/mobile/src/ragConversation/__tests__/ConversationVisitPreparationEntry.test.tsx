import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { ConversationScreen } from '../ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../ConversationSessionsContext';
import type { ConversationSessions } from '../conversationSessions';
import { conversationIntentRequests } from '../../aiFeatures/integration/conversationIntent';
import type { ConversationEntryContext } from '../../aiFeatures/integration/conversationIntent';
import { conversationEntryForSession } from '../useConversationEntryIntent';

jest.mock('../ConversationSavedRecaps', () => ({
  ConversationSavedRecaps: () => null,
}));
jest.mock('../manualVisitRecordService', () => ({
  openManualVisitRecords: jest.fn(async () => ({ load: async () => [] })),
}));

test('Home visit entry preserves drafts and prepares only after an explicit tap', async () => {
  let store!: ConversationSessions;
  let entry: ConversationEntryContext = {
    intent: 'conversation',
    entryKey: 'existing-conversation',
  };
  const send = jest.fn(async () => ({ status: 'no_evidence' as const }));
  const prepare = jest.fn(async () => ({ status: 'no_evidence' as const }));

  function Capture({ context }: { context: ConversationEntryContext }) {
    store = useConversationSessions();
    return (
      <ConversationScreen
        entryContext={context}
        onBack={jest.fn()}
        onOpenSource={jest.fn()}
        onSend={send}
        prepareVisitQuestions={prepare}
      />
    );
  }

  function Host({
    context,
    visible = true,
  }: {
    context: ConversationEntryContext;
    visible?: boolean;
  }) {
    return (
      <ConversationSessionsProvider>
        {visible ? <Capture context={context} /> : null}
      </ConversationSessionsProvider>
    );
  }

  const view = await render(<Host context={entry} />);
  const originalId = store.getSnapshot().activeId;
  await act(() => store.setDraft(originalId, '기존 대화 초안'));
  entry = {
    intent: 'visit-questions',
    entryKey: 'home-visit',
    appointmentId: 'appointment-a',
  };
  await act(async () => {
    view.rerender(<Host context={entry} />);
  });

  await waitFor(() =>
    expect(screen.getByTestId('conversation-visit-prepare')).toBeTruthy(),
  );
  const activeId = store.getSnapshot().activeId;
  expect(activeId).not.toBe(originalId);
  entry = { ...entry, appointmentId: 'appointment-b' };
  await act(async () => {
    view.rerender(<Host context={entry} />);
  });
  const emptyAppointmentBId = store.getSnapshot().activeId;
  expect(emptyAppointmentBId).not.toBe(activeId);
  entry = { ...entry, appointmentId: 'appointment-a' };
  await act(async () => {
    view.rerender(<Host context={entry} />);
  });
  expect(store.getSnapshot().activeId).toBe(activeId);
  expect(conversationEntryForSession(store, activeId)).toMatchObject({
    appointmentId: 'appointment-a',
  });
  expect(prepare).not.toHaveBeenCalled();
  entry = { intent: 'health-summary', entryKey: 'summary-entry' };
  await act(async () => {
    view.rerender(<Host context={entry} />);
  });
  const summarySessionId = store.getSnapshot().activeId;
  expect(summarySessionId).not.toBe(activeId);
  entry = {
    intent: 'visit-questions',
    entryKey: 'home-visit',
    appointmentId: 'appointment-a',
  };
  await act(async () => {
    view.rerender(<Host context={entry} />);
  });
  expect(store.getSnapshot().activeId).toBe(activeId);
  expect(screen.getByTestId('conversation-visit-prepare')).toBeTruthy();
  expect(prepare).not.toHaveBeenCalled();
  expect(
    store.getSnapshot().sessions.find(session => session.id === originalId)
      ?.draft,
  ).toBe('기존 대화 초안');
  expect(
    store.getSnapshot().sessions.find(session => session.id === activeId)
      ?.draft,
  ).toBe('');
  expect(prepare).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();

  await act(async () => {
    view.rerender(<Host context={{ ...entry }} visible={false} />);
  });
  await act(async () => {
    view.rerender(<Host context={{ ...entry }} />);
  });
  expect(store.getSnapshot().activeId).toBe(activeId);
  expect(screen.getByTestId('conversation-visit-prepare')).toBeTruthy();
  expect(prepare).not.toHaveBeenCalled();
  expect(screen.getByTestId('rag-conversation-input')).toHaveProp('value', '');

  const input = screen.getByTestId('rag-conversation-input');
  await fireEvent.changeText(input, '새 진료 초안');
  const observedComposerDrafts: string[] = [];
  const stopObservingDrafts = store.subscribe(() => {
    const snapshot = store.getSnapshot();
    observedComposerDrafts.push(
      snapshot.sessions.find(session => session.id === snapshot.activeId)
        ?.draft ?? '',
    );
  });
  await fireEvent.press(screen.getByTestId('conversation-visit-prepare'));
  await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
  stopObservingDrafts();
  expect(screen.getByTestId('rag-conversation-input')).toHaveProp(
    'value',
    '새 진료 초안',
  );
  expect(observedComposerDrafts).not.toContain(
    conversationIntentRequests['visit-questions'],
  );
  expect(prepare).toHaveBeenCalledWith(
    conversationIntentRequests['visit-questions'],
    [],
    expect.any(AbortSignal),
    expect.any(Object),
    {
      intent: 'visit-questions',
      entryKey: 'home-visit',
      appointmentId: 'appointment-a',
    },
  );
  expect(screen.getByTestId('rag-conversation-input')).toHaveProp(
    'value',
    '새 진료 초안',
  );
  expect(
    store.getSnapshot().sessions.find(session => session.id === originalId)
      ?.draft,
  ).toBe('기존 대화 초안');
  expect(send).not.toHaveBeenCalled();
  await act(async () => {
    view.rerender(<Host context={{ ...entry }} visible={false} />);
  });
  await act(async () => {
    view.rerender(<Host context={{ ...entry }} />);
  });
  expect(prepare).toHaveBeenCalledTimes(1);

  const preparedSessionId = store.getSnapshot().activeId;
  entry = { ...entry, appointmentId: 'appointment-b' };
  await act(async () => {
    view.rerender(<Host context={entry} />);
  });
  await waitFor(() =>
    expect(store.getSnapshot().activeId).not.toBe(preparedSessionId),
  );
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('rag-conversation-input')).toHaveProp('value', '');
  await fireEvent.press(screen.getByTestId('conversation-visit-prepare'));
  await waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
  expect(prepare).toHaveBeenLastCalledWith(
    conversationIntentRequests['visit-questions'],
    [],
    expect.any(AbortSignal),
    expect.any(Object),
    {
      intent: 'visit-questions',
      entryKey: 'home-visit',
      appointmentId: 'appointment-b',
    },
  );

  entry = { ...entry, appointmentId: 'appointment-a' };
  await act(async () => {
    view.rerender(<Host context={entry} />);
  });
  expect(store.getSnapshot().activeId).toBe(preparedSessionId);
  expect(conversationEntryForSession(store, preparedSessionId)).toMatchObject({
    appointmentId: 'appointment-a',
  });
  expect(
    store
      .getSnapshot()
      .sessions.find(session => session.id === preparedSessionId)?.draft,
  ).toBe('새 진료 초안');
  expect(prepare).toHaveBeenCalledTimes(2);
});
