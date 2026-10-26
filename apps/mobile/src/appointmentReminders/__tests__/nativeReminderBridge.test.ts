import { NativeModules } from 'react-native';
import {
  appointmentReminderPort,
  consumeAppointmentReminderTarget,
  subscribeAppointmentReminderOpened,
} from '../nativeReminderBridge';

it('reads a native empty inbox without inventing a notification target', async () => {
  await expect(consumeAppointmentReminderTarget()).resolves.toBeNull();
  expect(
    NativeModules.AppointmentReminderModule.consumeTarget,
  ).toHaveBeenCalledTimes(1);
  expect(
    NativeModules.AppointmentReminderModule.requestAuthorization,
  ).not.toHaveBeenCalled();
});

it('keeps an unavailable bridge observable for preference reads and delivery', async () => {
  delete NativeModules.AppointmentReminderModule;
  await expect(appointmentReminderPort.readSelection()).rejects.toThrow(
    'Local appointment reminders are unavailable.',
  );
  expect(() => consumeAppointmentReminderTarget()).toThrow(
    'Local appointment reminders are unavailable.',
  );
  expect(() => subscribeAppointmentReminderOpened(() => undefined)).toThrow(
    'Local appointment reminders are unavailable.',
  );
});

it('preserves an actual native inbox read failure', async () => {
  NativeModules.AppointmentReminderModule.consumeTarget.mockRejectedValueOnce(
    new Error('Synthetic inbox unavailable'),
  );
  await expect(consumeAppointmentReminderTarget()).rejects.toThrow(
    'Synthetic inbox unavailable',
  );
});
