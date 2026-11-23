import { render, screen } from '@testing-library/react-native';
import { RecordsHubSection } from '../RecordsHubSection';
import { ScheduleRoute } from '../ScheduleRoute';
import {
  bridge,
  repository,
  syncedCalendar,
} from '../../calendar/calendarLinkingTestFixtures';

// Recovery states must use the same header and native vertical owner as the loaded calendar.
test('uses the same vertical scroll owner and header across Calendar recovery and loaded content', async () => {
  const repo = repository(async () => []);
  function hub(appointmentState: 'loading' | 'failed' | 'ready') {
    return (
      <RecordsHubSection selected="schedule" onSelect={jest.fn(async () => {})}>
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
      </RecordsHubSection>
    );
  }
  const view = await render(hub('loading'));
  const scroll = screen.getByTestId('calendar-screen');
  const header = screen.getByTestId('records-hub-header');
  for (const state of ['failed', 'ready'] as const) {
    await view.rerender(hub(state));
    expect(screen.getAllByTestId('calendar-screen')).toEqual([scroll]);
    expect(screen.getByTestId('records-hub-header')).toBe(header);
    expect(scroll).toContainElement(header);
    expect(screen.getByTestId('records-hub-body')).not.toContainElement(header);
  }
  expect(scroll).toContainElement(screen.getByTestId('calendar-month-view'));
  expect(screen.queryByTestId('navigation-route-scroll')).toBeNull();
});
