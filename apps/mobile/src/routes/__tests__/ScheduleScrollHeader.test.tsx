import { render, screen } from '@testing-library/react-native';
import { NavigationRouteScrollView } from '../../navigation/NavigationRouteScrollView';
import { ScheduleRoute } from '../ScheduleRoute';
import {
  bridge,
  repository,
  syncedCalendar,
} from '../../calendar/calendarLinkingTestFixtures';

test('uses one vertical owner and one title across calendar recovery and loaded content', async () => {
  const repo = repository(async () => []);
  function route(appointmentState: 'loading' | 'failed' | 'ready') {
    return (
      <NavigationRouteScrollView testID="calendar-screen">
        <ScheduleRoute
          appointmentRepository={appointmentState === 'ready' ? repo : null}
          appointmentState={appointmentState}
          bridge={bridge()}
          calendarSync={syncedCalendar([])}
          onRetry={jest.fn()}
          onOpenAppointments={jest.fn()}
          onOpenMedicalAppointments={jest.fn()}
          onAppointmentsChanged={jest.fn()}
        />
      </NavigationRouteScrollView>
    );
  }
  const view = await render(route('loading'));
  const scroll = screen.getByTestId('calendar-screen');
  for (const state of ['failed', 'ready'] as const) {
    await view.rerender(route(state));
    expect(screen.getAllByTestId('calendar-screen')).toEqual([scroll]);
    expect(scroll).toContainElement(
      screen.getByRole('header', { name: '일정' }),
    );
    expect(screen.queryByTestId('records-section-tabs')).toBeNull();
  }
  expect(scroll).toContainElement(screen.getByTestId('calendar-month-view'));
  expect(screen.queryByTestId('navigation-route-scroll')).toBeNull();
});
