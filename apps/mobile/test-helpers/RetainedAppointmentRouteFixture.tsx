import { useMemo } from 'react';
import { Text } from 'react-native';
import type { AppointmentRepository } from '@orot/storage';
import type { CalendarBridge } from '../src/calendar/types';
import type { CalendarAutoSyncState } from '../src/calendar/calendarAutoSync';
import MedicalAppointmentRoute from '../src/medicalAppointments/MedicalAppointmentRoute';
import { createNavigationController } from '../src/navigation/navigationController';
import { NavigationRouteAdapter } from '../src/navigation/NavigationRouteAdapter';
import { appContentLayoutOwner } from '../src/navigation/appContentLayoutPolicy';

/** Preserves legacy appointment editing/guard evidence without restoring the removed classification entry. */
export function RetainedAppointmentRouteFixture({
  repository,
}: {
  readonly repository: AppointmentRepository;
}) {
  const controller = useMemo(() => {
    const value = createNavigationController<'medical-manual' | 'schedule'>(
      'schedule',
    );
    value.push('medical-manual');
    return value;
  }, []);
  const loadAppointments = useMemo(() => async () => repository, [repository]);
  return (
    <NavigationRouteAdapter
      controller={controller}
      contentLayoutOwner={appContentLayoutOwner}
    >
      {({ route }) =>
        route.name === 'medical-manual' ? (
          <MedicalAppointmentRoute
            manual
            bridge={{} as CalendarBridge}
            calendarSync={{} as CalendarAutoSyncState}
            loadAppointments={loadAppointments}
            onOpenCalendarSettings={() => undefined}
          />
        ) : (
          <Text testID="retained-appointment-route-return">Returned</Text>
        )
      }
    </NavigationRouteAdapter>
  );
}
