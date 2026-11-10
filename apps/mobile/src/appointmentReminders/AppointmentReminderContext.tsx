import { createContext, useContext, useMemo } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { AppointmentRepository } from '@orot/storage';
import { AppointmentReminderCoordinator } from './reminderCoordinator';
import { appointmentReminderPort } from './nativeReminderBridge';
import { withAppointmentReminders } from './reminderRepository';
import type { AppointmentReminderTarget } from './reminderPlan';
import type { DailyReminderEntry } from './dailyReminderDelivery';
import type { DailyReportConversationIntent } from '../aiFeatures/integration/conversationIntent';
import type { createDailyReportFeature } from '../aiFeatures/integration/dailyReportFeature';

type Loader = () => Promise<AppointmentRepository>;

/** Wrap every app repository entry, including Calendar and manual edits. */
export function createAppointmentReminderRuntime(load: Loader) {
  const list = async () => (await load()).list();
  const coordinator = new AppointmentReminderCoordinator(
    list,
    appointmentReminderPort,
  );
  return {
    coordinator,
    list,
    load: async () => withAppointmentReminders(await load(), coordinator),
    // A route key binds a delivered tap to its own visit, never the next visit.
    targets: new Map<string, AppointmentReminderTarget>(),
    // Home can show manual or already-started visits; these read-only targets never enter reminder scheduling or inference.
    homePreparationTargets: new Map<string, string>(),
    // The exact observed day is retained for this route, including provider detours.
    dailyReportTargets: new Map<string, DailyReminderEntry>(),
    dailyConversationTargets: new Map<
      string,
      {
        intent: DailyReportConversationIntent;
        operation: ReturnType<
          ReturnType<typeof createDailyReportFeature>['start']
        >;
      }
    >(),
  };
}

export type AppointmentReminderRuntime = ReturnType<
  typeof createAppointmentReminderRuntime
>;
const Context = createContext<AppointmentReminderRuntime | null>(null);
export const useAppointmentReminderRuntime = () => useContext(Context);

export function AppointmentReminderProvider({
  runtime,
  children,
}: {
  readonly runtime: AppointmentReminderRuntime;
  readonly children: ReactNode;
}) {
  return <Context.Provider value={runtime}>{children}</Context.Provider>;
}

export async function defaultReminderAppointmentLoader() {
  const { openLocalAppointmentRepository } =
    await import('../appointments/localRepository');
  return openLocalAppointmentRepository();
}

/** Keep App's injected repository contract while sharing one coordinator. */
export function withAppointmentReminderApp<
  P extends { loadAppointments?: Loader },
>(Component: ComponentType<P>) {
  return function ReminderApp(props: P) {
    const load = props.loadAppointments ?? defaultReminderAppointmentLoader;
    const runtime = useMemo(
      () => createAppointmentReminderRuntime(load),
      [load],
    );
    return (
      <AppointmentReminderProvider runtime={runtime}>
        <Component {...props} loadAppointments={runtime.load} />
      </AppointmentReminderProvider>
    );
  };
}
