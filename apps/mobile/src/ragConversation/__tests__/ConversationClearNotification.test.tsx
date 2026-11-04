import { useSyncExternalStore } from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../ConversationSessionsContext';
import {
  notifyLocalDataCleared,
  notifyLocalSourceDeleted,
} from '../../storage/localDataClearEvents';

function SessionView() {
  const store = useConversationSessions();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <Text onPress={() => store.setDraft(state.activeId, 'private draft')}>
      {state.sessions[0]?.draft || 'empty'}
    </Text>
  );
}

test('committed local-data clear removes the app-owned conversation draft from mounted UI', async () => {
  await render(
    <ConversationSessionsProvider>
      <SessionView />
    </ConversationSessionsProvider>,
  );
  await act(() => {
    screen.getByText('empty').props.onPress();
  });
  expect(screen.getByText('private draft')).toBeTruthy();
  await act(() => {
    notifyLocalDataCleared();
  });
  expect(screen.queryByText('private draft')).toBeNull();
  expect(screen.getByText('empty')).toBeTruthy();
});

function AnswerView() {
  const store = useConversationSessions();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <Text
      onPress={() => {
        store.setDraft(state.activeId, 'question');
        store.send(state.activeId, async () => ({
          status: 'answer',
          answer: 'private answer',
          citations: [],
        }));
      }}
    >
      {state.sessions[0]?.messages.at(-1)?.content ?? 'empty'}
    </Text>
  );
}

test('committed source removal clears visible conversation content through the app provider', async () => {
  await render(
    <ConversationSessionsProvider>
      <AnswerView />
    </ConversationSessionsProvider>,
  );
  await act(async () => {
    screen.getByText('empty').props.onPress();
  });
  expect(screen.getByText('private answer')).toBeTruthy();
  await act(() => {
    notifyLocalSourceDeleted();
  });
  expect(screen.queryByText('private answer')).toBeNull();
  expect(screen.getByText('empty')).toBeTruthy();
});
