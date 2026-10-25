import type { AppointmentReminderPort, ReminderAuthorization } from './reminderCoordinator';
import type { AppointmentReminderPlan, AppointmentReminderSelection } from './reminderPlan';

export interface AppointmentReminderNativeModule {
  readSelection(): Promise<unknown>;
  writeSelection(value: AppointmentReminderSelection | null): Promise<void>;
  authorizationStatus(): Promise<unknown>;
  requestAuthorization(): Promise<unknown>;
  replace(value: AppointmentReminderPlan | null): Promise<void>;
  consumeTarget(): Promise<unknown>;
}

function authorization(value: unknown): ReminderAuthorization {
  if (value === 'authorized' || value === 'denied' || value === 'notDetermined')
    return value;
  throw new Error('Notification authorization is unavailable.');
}

/** Fail visibly on an unavailable or incompatible native bridge, without logging health data. */
export function createAppointmentReminderPort(
  native: () => AppointmentReminderNativeModule,
): AppointmentReminderPort {
  return {
    async readSelection() {
      const value = await native().readSelection();
      if (value === null) return null;
      if (!value || typeof value !== 'object')
        throw new Error('The saved reminder preference is invalid.');
      const choice = value as Partial<AppointmentReminderSelection>;
      if (
        typeof choice.appointmentId !== 'string' ||
        !choice.appointmentId ||
        (choice.leadMinutes !== 60 && choice.leadMinutes !== 1440)
      )
        throw new Error('The saved reminder preference is invalid.');
      return { appointmentId: choice.appointmentId, leadMinutes: choice.leadMinutes };
    },
    writeSelection: value => native().writeSelection(value),
    authorizationStatus: async () => authorization(await native().authorizationStatus()),
    requestAuthorization: async () => authorization(await native().requestAuthorization()),
    replace: value => native().replace(value),
  };
}
