import { render, screen } from '@testing-library/react-native';
import { RecordsHubSection } from '../RecordsHubSection';
import { ScheduleRoute } from '../ScheduleRoute';
import {
  bridge,
  syncedCalendar,
} from '../../calendar/calendarLinkingTestFixtures';

// Recovery states must use the same stationary hub header as the loaded calendar.
test.each(['loading', 'failed'] as const)(
  'keeps the schedule header outside the scroll view while storage is %s',
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
    const header = screen.getByTestId('records-hub-header');
    expect(header).toBeVisible();
    expect(screen.getByTestId('navigation-route-scroll')).not.toContainElement(
      header,
    );
  },
);
