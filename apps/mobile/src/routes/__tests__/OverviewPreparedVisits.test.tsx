import { act, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { OverviewPreparedVisits } from '../OverviewPreparedVisits';
import { ManualVisitTargetPanels } from '../../ragConversation/ManualVisitTargetPanels';

let mockFocused = true;
const initialAppState = AppState.currentState;
beforeEach(() => {
  AppState.currentState = 'active';
});
afterEach(() => {
  AppState.currentState = initialAppState;
});
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockFocused,
}));
jest.mock('../../ragConversation/ManualVisitRecords', () => ({
  ManualVisitRecords: ({ appointmentId }: { appointmentId: string }) => {
    const { Text } = require('react-native');
    return <Text>{`prepared:${appointmentId}`}</Text>;
  },
}));
jest.mock('../../ragConversation/ConversationSavedRecaps', () => ({
  ConversationSavedRecaps: ({ appointmentId }: { appointmentId: string }) => {
    const { Text } = require('react-native');
    return <Text>{`recap:${appointmentId}`}</Text>;
  },
}));
const session = { id: 0, messages: [], restoring: false };
const store = {
  toolSourceSessionId: () => null,
  entryContextForSession: () => undefined,
};
jest.mock('../../ragConversation/ConversationSessionsContext', () => ({
  useConversationSessions: () => store,
}));
jest.mock('../../ragConversation/useConversationPresentationSnapshot', () => ({
  useConversationPresentationSnapshot: () => ({
    activeId: 0,
    sessions: [session],
  }),
}));

test('shows existing prepared actions only on focused foreground Overview', async () => {
  let change: (state: string) => void = () => {};
  const listener = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((event, callback) => {
      if (event === 'change') change = callback as typeof change;
      return { remove: jest.fn() };
    });
  await render(<OverviewPreparedVisits appointmentId="synthetic-visit" />);
  expect(screen.getByText('prepared:synthetic-visit')).toBeTruthy();
  expect(screen.queryByText('recap:synthetic-visit')).toBeNull();
  await act(async () => change('background'));
  expect(screen.queryByText('prepared:synthetic-visit')).toBeNull();
  await act(async () => change('active'));
  expect(screen.getByText('prepared:synthetic-visit')).toBeTruthy();
  mockFocused = false;
  await screen.rerender(
    <OverviewPreparedVisits appointmentId="synthetic-visit" />,
  );
  expect(screen.queryByText('prepared:synthetic-visit')).toBeNull();
  mockFocused = true;
  listener.mockRestore();
});

test('conversation retains recap results without duplicating the moved preparation editor', async () => {
  await render(
    <ManualVisitTargetPanels
      content="recaps"
      appointmentId="synthetic-visit"
      store={store as never}
      sessionId={0}
      session={session as never}
      messages={[]}
      compact={false}
      disclaimer=""
    />,
  );
  expect(screen.getByText('recap:synthetic-visit')).toBeTruthy();
  expect(screen.queryByText('prepared:synthetic-visit')).toBeNull();
});
