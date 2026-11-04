import { useSyncExternalStore } from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import {
  ConversationSessionsProvider,
  useConversationSessions,
} from '../ConversationSessionsContext';
import { notifyLocalDataCleared } from '../../storage/localDataClearEvents';

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
