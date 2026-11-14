import { render, screen, within } from '@testing-library/react-native';
import { RecordsHubSection } from '../RecordsHubSection';
import { ScheduleRoute } from '../ScheduleRoute';
import {
  bridge,
  syncedCalendar,
} from '../../calendar/calendarLinkingTestFixtures';

// Recovery states must use the same scrollable hub header as the loaded calendar.
test.each(['loading', 'failed'] as const)(
  'scrolls the schedule header while storage is %s',
  async appointmentState => {
    await render(
      <RecordsHubSection selected="schedule" onSelect={jest.fn(async () => {})}>
        <ScheduleRoute
          appointmentRepository={null}
          appointmentState={appointmentState}
          bridge={bridge()}
          calendarSync={syncedCalendar([])}
          onRetry={jest.fn()}
          onOpenAppointments={jest.fn()}
          onOpenMedicalAppointments={jest.fn()}
          onAppointmentsChanged={jest.fn()}
        />
      </RecordsHubSection>,
    );
    expect(
      within(screen.getByTestId('navigation-route-scroll')).getByTestId(
        'records-hub-header',
      ),
    ).toBeVisible();
  },
);
