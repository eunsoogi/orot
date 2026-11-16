import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppRouteContent } from '../AppRouteContent';
import type { AppRouteContentProps } from '../AppProps';
import { createConversationSessions } from '../../ragConversation/conversationSessions';

const mockStore = createConversationSessions();
jest.mock('../../ragConversation/ConversationSessionsContext', () => ({
  useConversationSessions: () => mockStore,
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));
jest.mock('../OverviewRoute', () => {
  const { Button } = require('react-native');
  return {
    __esModule: true,
    default: ({ onPrepareVisit }: { onPrepareVisit: () => void }) => (
      <Button title="prepare visit" onPress={onPrepareVisit} />
    ),
  };
});

// Exercise the production route callback without invoking a provider or real calendar.
test.each([undefined, { id: 'synthetic-visit' }])(
  'visit preparation selects the retained tab without replacing its session',
  async nextAppointment => {
    const selectTab = jest.fn();
    const push = jest.fn();
    const id = mockStore.getSnapshot().activeId;
    mockStore.setDraft(id, 'existing synthetic draft');
    const before = mockStore.getSnapshot();
    const view = await render(
      <AppRouteContent
        {...({
          actions: { route: { name: 'root', key: 'root' }, push },
          activeTab: 'overview',
          selectTab,
          nextAppointment,
          recordings: [],
        } as unknown as AppRouteContentProps)}
      />,
    );
    await fireEvent.press(screen.getByText('prepare visit'));
    await fireEvent.press(screen.getByText('prepare visit'));
    expect(selectTab.mock.calls).toEqual([['conversation'], ['conversation']]);
    expect(push).not.toHaveBeenCalled();
    expect(mockStore.getSnapshot()).toBe(before);
    await view.unmount();
  },
);
