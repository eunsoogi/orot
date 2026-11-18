import { AppointmentReminderProvider } from '../../appointmentReminders/AppointmentReminderContext';
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
  'visit questions bind the displayed appointment without changing a model session',
  async nextAppointment => {
    const selectTab = jest.fn();
    const push = jest.fn(() => ({
      name: 'visit-day-questions',
      key: 'day-route',
    }));
    const runtime = { overviewPreparationTargets: new Map() };
    const id = mockStore.getSnapshot().activeId;
    mockStore.setDraft(id, 'existing synthetic draft');
    const before = mockStore.getSnapshot();
    const view = await render(
      <AppointmentReminderProvider runtime={runtime as never}>
        <AppRouteContent
          {...({
            actions: { route: { name: 'root', key: 'root' }, push },
            activeTab: 'overview',
            selectTab,
            nextAppointment,
            recordings: [],
          } as unknown as AppRouteContentProps)}
        />
      </AppointmentReminderProvider>,
    );
    await fireEvent.press(screen.getByText('prepare visit'));
    await fireEvent.press(screen.getByText('prepare visit'));
    expect(selectTab).not.toHaveBeenCalled();
    if (nextAppointment) {
      expect(push).toHaveBeenCalledWith('visit-day-questions');
      expect(runtime.overviewPreparationTargets.get('day-route')).toBe(
        'synthetic-visit',
      );
    } else expect(push).not.toHaveBeenCalled();
    expect(mockStore.getSnapshot()).toBe(before);
    await view.unmount();
  },
);
