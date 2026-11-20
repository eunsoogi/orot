import {
  createContext,
  useContext,
  useMemo,
  type Context,
  type ReactNode,
} from 'react';
import type { NavigationController } from '../navigation/navigationController';
import type { AppRootTab } from '../navigation/rootTabs';
import { AppRouteContent } from './AppRouteContent';
import type { AppRouteContentProps } from './AppProps';
import type { AppNavigationRoute } from './appNavigationRoute';
import { useAppOverviewData } from './useAppOverviewData';
import { useOverviewActivity } from './useOverviewActivity';

type OwnerData = ReturnType<typeof useAppOverviewData>;
type AppointmentData = Pick<
  OwnerData,
  | 'appointmentRepository'
  | 'appointmentState'
  | 'nextAppointment'
  | 'refreshAppointments'
>;
type RecordingData = Pick<
  OwnerData,
  'recordings' | 'recordingState' | 'refreshRecordings'
>;
const Appointments = createContext<AppointmentData | null>(null);
const Recordings = createContext<RecordingData | null>(null);

type Inputs = Parameters<typeof useAppOverviewData>;

/** A data refresh publishes only to route subscribers, not the navigation shell. */
export function AppOverviewDataBoundary({
  activeTab,
  controller,
  loadAppointments,
  loadRecordings,
  children,
}: {
  readonly activeTab: AppRootTab;
  readonly controller: NavigationController<AppNavigationRoute>;
  readonly loadAppointments: Inputs[0];
  readonly loadRecordings: Inputs[1];
  readonly children: ReactNode;
}) {
  const active = useOverviewActivity(controller, activeTab);
  const {
    appointmentRepository,
    appointmentState,
    nextAppointment,
    recordings,
    recordingState,
    refreshAppointments,
    refreshRecordings,
  } = useAppOverviewData(loadAppointments, loadRecordings, active);
  const appointmentData = useMemo(
    () => ({
      appointmentRepository,
      appointmentState,
      nextAppointment,
      refreshAppointments,
    }),
    [
      appointmentRepository,
      appointmentState,
      nextAppointment,
      refreshAppointments,
    ],
  );
  const recordingData = useMemo(
    () => ({
      recordings,
      recordingState,
      refreshRecordings,
    }),
    [recordings, recordingState, refreshRecordings],
  );
  return (
    <Appointments.Provider value={appointmentData}>
      <Recordings.Provider value={recordingData}>
        {children}
      </Recordings.Provider>
    </Appointments.Provider>
  );
}

type RouteProps = Omit<AppRouteContentProps, keyof OwnerData>;
const idleAppointments: AppointmentData = {
  appointmentRepository: null,
  appointmentState: 'loading',
  nextAppointment: null,
  refreshAppointments: async () => {},
};
const idleRecordings: RecordingData = {
  recordings: [],
  recordingState: 'loading',
  refreshRecordings: async () => {},
};

/** Subscribe only to the independently owned data actually rendered by each route. */
export function AppOverviewDataRouteContent(props: RouteProps) {
  const route = props.actions.route.name;
  const root = route === 'root' ? props.activeTab : undefined;
  if (root === 'overview') return <OverviewRouteContent {...props} />;
  if (root === 'schedule' || route === 'appointments')
    return <AppointmentRouteContent {...props} />;
  if (root === 'records' || route === 'recent-records')
    return <RecordingRouteContent {...props} />;
  return (
    <AppRouteContent {...props} {...idleAppointments} {...idleRecordings} />
  );
}

function useOwnedData<T>(owner: Context<T | null>) {
  const data = useContext(owner);
  if (!data) throw new Error('The overview data owner is missing.');
  return data;
}

function OverviewRouteContent(props: RouteProps) {
  const appointments = useOwnedData(Appointments);
  const recordings = useOwnedData(Recordings);
  return <AppRouteContent {...props} {...appointments} {...recordings} />;
}

function AppointmentRouteContent(props: RouteProps) {
  const appointments = useOwnedData(Appointments);
  return <AppRouteContent {...props} {...appointments} {...idleRecordings} />;
}

function RecordingRouteContent(props: RouteProps) {
  const recordings = useOwnedData(Recordings);
  return <AppRouteContent {...props} {...idleAppointments} {...recordings} />;
}
