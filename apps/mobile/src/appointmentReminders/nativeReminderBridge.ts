import { NativeEventEmitter, NativeModules } from 'react-native';
import { createAppointmentReminderPort } from './reminderPort';
import type { AppointmentReminderNativeModule } from './reminderPort';

// RCTEventEmitter supplies listener-count bookkeeping required by NativeEventEmitter.
type ReminderEventModule = AppointmentReminderNativeModule & {
  addListener(eventType: string): void;
  removeListeners(count: number): void;
};

function native(): ReminderEventModule {
  const module = NativeModules.AppointmentReminderModule;
  if (!module) throw new Error('Local appointment reminders are unavailable.');
  return module as ReminderEventModule;
}

export const appointmentReminderPort = createAppointmentReminderPort(native);

/** The caller must validate this untrusted OS payload against current local appointments. */
export function consumeAppointmentReminderTarget(): Promise<unknown> {
  return native().consumeTarget();
}

/** Subscribe before draining the inbox so cold-start and foreground taps share one path. */
export function subscribeAppointmentReminderOpened(
  listener: () => void,
): () => void {
  const module = native();
  const events = new NativeEventEmitter(module);
  const subscription = events.addListener(
    'appointmentReminderOpened',
    listener,
  );
  return () => subscription.remove();
}
