import { act, render, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { ConversationScreen } from '../ConversationScreen';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../ConversationSessionsContext';
import type { ConversationSessions } from '../conversationSessions';
import type { ConversationEntryContext } from '../../aiFeatures/integration/conversationIntent';

jest.mock('../ConversationSavedRecaps', () => ({
  ConversationSavedRecaps: () => null,
}));
jest.mock('../manualVisitRecordService', () => ({
  openManualVisitRecords: jest.fn(async () => ({ load: async () => [] })),
}));

test('Home visit entry keeps restored history and offers preparation in a fresh session', async () => {
  let store!: ConversationSessions;
  let setEntry!: (context: ConversationEntryContext) => void;
  const send = jest.fn(async () => ({ status: 'no_evidence' as const }));
  const prepare = jest.fn(async () => ({ status: 'no_evidence' as const }));
  const options = {
    retention: {
      attachExisting: async () => {},
      activeIdentity: () => 'saved-session',
      activeLease: () => null,
      beginTurn: async () => undefined,
      invalidate: () => {},
    } as never,
    restoreSession: async () => [
      {
        question: '기존 질문',
        answer: '기존 답변',
        citations: [],
      },
    ],
  };

  function Capture() {
    const [context, updateContext] = useState<ConversationEntryContext>({
      intent: 'conversation',
      entryKey: 'plain-entry',
    });
    setEntry = updateContext;
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

  await render(
    <ConversationSessionsProvider options={options}>
      <Capture />
    </ConversationSessionsProvider>,
  );
  let restoredId = 0;
  await act(async () => {
    restoredId = await store.attachExisting(
      'saved-session',
      0,
      '2026-10-05T00:00:00.000Z',
    );
  });
  expect(screen.getByText('기존 답변')).toBeTruthy();
  await act(async () => {
    setEntry({
      intent: 'visit-questions',
      entryKey: 'home-visit',
      appointmentId: 'appointment-restored',
    });
  });

  await waitFor(() =>
    expect(screen.getByTestId('conversation-visit-prepare')).toBeTruthy(),
  );
  const activeId = store.getSnapshot().activeId;
  expect(activeId).not.toBe(restoredId);
  expect(
    store
      .getSnapshot()
      .sessions.find(session => session.id === restoredId)
      ?.messages.map(message => message.content),
  ).toEqual(['기존 질문', '기존 답변']);
  expect(
    store.getSnapshot().sessions.find(session => session.id === activeId)
      ?.draft,
  ).toBe('');
  expect(screen.getByTestId('rag-conversation-input')).toHaveProp('value', '');
  expect(send).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
});
